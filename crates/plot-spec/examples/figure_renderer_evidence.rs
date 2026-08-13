//! Unstable, developer-only figure-renderer evidence harness.
//!
//! It answers the question the deterministic suite cannot: what does the
//! semantic export renderer actually cost, and what does it actually emit, on
//! scenes the size of real measurements?
//!
//! Everything it prints is a count, a duration or a byte size. No scene here is
//! read from disk, so nothing it reports is about anybody's data: the scenes are
//! generated from a fixed linear congruential sequence, which is also why two
//! runs on one machine produce the same numbers and why the TypeScript harness
//! beside it can generate the identical points.
//!
//! Run it directly:
//!
//! ```text
//! cargo run --release -p mscanvas-plot-spec --example figure_renderer_evidence
//! ```

use mscanvas_plot_spec::spec::{
    AxisSpec, DataScope, Domain, FigureSize, FigureSpec, FigureTheme, Label, PanelSpec, PlotKind,
    ReductionRule, SeriesSpec, SpectrumRepresentation, StyleRole, UnitState,
};
use mscanvas_plot_spec::svg;
use std::time::{Duration, Instant};

/// The sequence both harnesses draw their scenes from.
///
/// A linear congruential generator with the numerical-recipes constants, seeded
/// once per scene. Reproduced exactly in the TypeScript harness, so the two
/// measure the same points rather than two similar-looking clouds.
struct Lcg(u32);

impl Lcg {
    const fn new(seed: u32) -> Self {
        Self(seed)
    }

    fn next_unit(&mut self) -> f64 {
        self.0 = self.0.wrapping_mul(1_664_525).wrapping_add(1_013_904_223);
        f64::from(self.0) / f64::from(u32::MAX)
    }
}

/// One generated scene, before it becomes a specification.
struct Scene {
    name: &'static str,
    kind: PlotKind,
    x: Vec<f64>,
    y: Vec<f64>,
}

/// A chromatogram-shaped trace: a slow baseline with a few eluting peaks and
/// per-point noise.
fn chromatogram(points: usize) -> Scene {
    let mut noise = Lcg::new(0x2545_F491);
    let mut x = Vec::with_capacity(points);
    let mut y = Vec::with_capacity(points);
    for index in 0..points {
        let time = (index as f64) * (30.0 / points as f64);
        let mut intensity = 400.0 + 60.0 * (time * 0.4).sin();
        for (centre, height, width) in [
            (6.0, 9_000.0, 0.18),
            (11.5, 42_000.0, 0.09),
            (19.0, 15_500.0, 0.25),
        ] {
            let offset = (time - centre) / width;
            intensity += height * (-0.5 * offset * offset).exp();
        }
        intensity += (noise.next_unit() - 0.5) * 220.0;
        x.push(time);
        y.push(intensity);
    }
    Scene {
        name: "chromatogram-100k",
        kind: PlotKind::Chromatogram,
        x,
        y,
    }
}

/// A profile-shaped spectrum: dense, evenly spaced samples across isotope
/// envelopes, with a baseline that dips below zero.
fn profile_spectrum(points: usize, name: &'static str) -> Scene {
    let mut noise = Lcg::new(0x9E37_79B9);
    let mut x = Vec::with_capacity(points);
    let mut y = Vec::with_capacity(points);
    for index in 0..points {
        let mz = 200.0 + (index as f64) * (1_800.0 / points as f64);
        let mut intensity = -35.0 + (noise.next_unit() - 0.5) * 40.0;
        for cluster in 0..14 {
            let centre = 260.0 + f64::from(cluster) * 118.0;
            for isotope in 0..4 {
                let peak = centre + f64::from(isotope) * 1.003;
                let offset = (mz - peak) / 0.012;
                intensity += (52_000.0 / f64::from(isotope + 1)) * (-0.5 * offset * offset).exp();
            }
        }
        x.push(mz);
        y.push(intensity);
    }
    Scene {
        name,
        kind: PlotKind::Spectrum {
            representation: SpectrumRepresentation::Profile,
        },
        x,
        y,
    }
}

/// A centroid-shaped spectrum: sparse discrete peaks on an ordered axis.
fn centroid_spectrum(points: usize) -> Scene {
    let mut noise = Lcg::new(0xB5297A4D);
    let mut x = Vec::with_capacity(points);
    let mut y = Vec::with_capacity(points);
    let mut mz = 150.0;
    for _ in 0..points {
        mz += 0.02 + noise.next_unit() * 0.16;
        let intensity = if noise.next_unit() < 0.04 {
            noise.next_unit() * 90_000.0
        } else {
            noise.next_unit() * 1_400.0
        };
        x.push(mz);
        y.push(intensity);
    }
    Scene {
        name: "centroid-dense-20k",
        kind: PlotKind::Spectrum {
            representation: SpectrumRepresentation::Centroid,
        },
        x,
        y,
    }
}

/// The reduction the screen performs, applied here so the export harness can
/// report what a reduced panel costs beside what a full-source one costs.
///
/// The same rule the screen states: the highest and the lowest value of each
/// column, both kept, because intensity may be negative.
fn reduce_min_max(x: &[f64], y: &[f64], columns: usize) -> (Vec<f64>, Vec<f64>) {
    if x.is_empty() {
        return (Vec::new(), Vec::new());
    }
    let low = x[0];
    let high = x[x.len() - 1];
    let span = high - low;
    let mut highest: Vec<Option<(f64, f64)>> = vec![None; columns];
    let mut lowest: Vec<Option<(f64, f64)>> = vec![None; columns];
    for (value, height) in x.iter().zip(y.iter()) {
        let fraction = if span > 0.0 {
            (value - low) / span
        } else {
            0.5
        };
        let column = ((fraction * columns as f64) as usize).min(columns - 1);
        if *height >= 0.0 {
            let slot = &mut highest[column];
            if slot.is_none_or(|(_, kept)| *height > kept) {
                *slot = Some((*value, *height));
            }
        } else {
            let slot = &mut lowest[column];
            if slot.is_none_or(|(_, kept)| *height < kept) {
                *slot = Some((*value, *height));
            }
        }
    }
    let mut kept: Vec<(f64, f64)> = highest.into_iter().chain(lowest).flatten().collect();
    kept.sort_by(|left, right| left.0.total_cmp(&right.0));
    kept.into_iter().unzip()
}

fn domain_of(values: &[f64]) -> Domain {
    let low = values.iter().copied().fold(f64::INFINITY, f64::min);
    let high = values.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if values.is_empty() {
        return Domain::new(0.0, 1.0).expect("a unit domain is valid");
    }
    Domain::new(low.min(0.0), high.max(0.0)).expect("a measured domain is finite and ordered")
}

fn figure_of(scene: &Scene, scope: DataScope, x: Vec<f64>, y: Vec<f64>) -> FigureSpec {
    let (x_label, x_unit, y_label) = match scene.kind {
        PlotKind::Chromatogram => (
            "Retention time",
            UnitState::Known {
                unit: Label::new("min").expect("a unit label"),
            },
            "Intensity",
        ),
        PlotKind::Spectrum { .. } => ("m/z", UnitState::Dimensionless, "Intensity"),
    };
    let full_domain = if x.is_empty() {
        Domain::new(0.0, 1.0).expect("a unit domain is valid")
    } else {
        Domain::new(x[0], x[x.len() - 1]).expect("an ordered axis yields an ordered domain")
    };
    let value_domain = domain_of(&y);
    let series = SeriesSpec::new(
        Label::new("measurement").expect("a series identifier"),
        StyleRole::Measurement,
        scope,
        x,
        y,
    )
    .expect("a generated scene is a valid series");
    let panel = PanelSpec::new(
        scene.kind,
        AxisSpec::new(Label::new(x_label).expect("an axis label"), x_unit),
        AxisSpec::new(
            Label::new(y_label).expect("an axis label"),
            UnitState::Unreported,
        ),
        full_domain,
        value_domain,
        vec![series],
    )
    .expect("a generated panel is valid");
    FigureSpec::new(
        FigureTheme::Light,
        FigureSize::new(1_200.0, 640.0).expect("a bounded figure size"),
        vec![panel],
    )
    .expect("one panel is a valid figure")
}

/// Runs one closure repeatedly and reports the median and the maximum.
fn measure(runs: usize, mut body: impl FnMut() -> usize) -> (Duration, Duration, usize) {
    // Two warm-up passes, discarded. The first touches cold allocator pages and
    // is not what a steady-state render costs.
    let mut last = 0;
    for _ in 0..2 {
        last = body();
    }
    let mut samples = Vec::with_capacity(runs);
    for _ in 0..runs {
        let started = Instant::now();
        last = body();
        samples.push(started.elapsed());
    }
    samples.sort_unstable();
    let median = samples[samples.len() / 2];
    let maximum = *samples.last().expect("at least one sample");
    (median, maximum, last)
}

fn count_elements(document: &str) -> usize {
    document.matches('<').count() - document.matches("</").count() - 1
}

fn report(label: &str, source_points: usize, drawn: usize, figure: &FigureSpec) {
    let (median, maximum, bytes) = measure(9, || svg::render(figure).len());
    let document = svg::render(figure);
    println!(
        "{label:<34} source={source_points:>7} drawn={drawn:>7} \
         render_median={median:>10.3?} render_max={maximum:>10.3?} \
         svg_bytes={bytes:>9} svg_elements={:>5} text_nodes={:>3}",
        count_elements(&document),
        document.matches("<text").count(),
    );
}

fn main() {
    println!("# figure renderer evidence — semantic FigureSpec to export SVG (Rust)");
    println!(
        "# rustc={} profile={} target={}",
        option_env!("CARGO_PKG_RUST_VERSION").unwrap_or("unknown"),
        if cfg!(debug_assertions) {
            "debug"
        } else {
            "release"
        },
        std::env::consts::ARCH,
    );
    println!();

    let scenes = [
        chromatogram(100_000),
        profile_spectrum(60_000, "profile-dense-60k"),
        centroid_spectrum(20_000),
        profile_spectrum(500_000, "transfer-bound-500k"),
    ];

    println!("## full source, exported whole");
    for scene in &scenes {
        let figure = figure_of(
            scene,
            DataScope::FullSource,
            scene.x.clone(),
            scene.y.clone(),
        );
        report(scene.name, scene.x.len(), scene.x.len(), &figure);
    }

    println!();
    println!("## reduced to 900 screen columns, exported as a reduction");
    for scene in &scenes {
        let (x, y) = reduce_min_max(&scene.x, &scene.y, 900);
        let drawn = x.len();
        let figure = figure_of(
            scene,
            DataScope::Reduced {
                source_point_count: scene.x.len(),
                rule: ReductionRule::MinMaxPerColumn,
            },
            x,
            y,
        );
        report(scene.name, scene.x.len(), drawn, &figure);
    }

    println!();
    println!("## reduction cost alone, without rendering");
    for scene in &scenes {
        let (median, maximum, drawn) =
            measure(9, || reduce_min_max(&scene.x, &scene.y, 900).0.len());
        println!(
            "{:<34} source={:>7} drawn={drawn:>7} reduce_median={median:>10.3?} \
             reduce_max={maximum:>10.3?}",
            scene.name,
            scene.x.len(),
        );
    }

    println!();
    println!("## edge scenes");
    let edges: [(&str, Vec<f64>, Vec<f64>); 5] = [
        ("empty", Vec::new(), Vec::new()),
        ("single-point", vec![512.5], vec![900.0]),
        (
            "flat",
            (0..1_000).map(f64::from).collect(),
            vec![7.0; 1_000],
        ),
        (
            "all-negative",
            (0..1_000).map(f64::from).collect(),
            (0..1_000).map(|index| -f64::from(index) - 1.0).collect(),
        ),
        (
            "all-zero",
            (0..1_000).map(f64::from).collect(),
            vec![0.0; 1_000],
        ),
    ];
    for (name, x, y) in edges {
        let scene = Scene {
            name: "edge",
            kind: PlotKind::Spectrum {
                representation: SpectrumRepresentation::Unreported,
            },
            x: x.clone(),
            y: y.clone(),
        };
        let points = x.len();
        let figure = figure_of(&scene, DataScope::FullSource, x, y);
        let document = svg::render(&figure);
        // `external_free` deliberately does not look for `http://`. The SVG
        // namespace declaration is required by the format and is not a
        // reference to anything -- nothing is fetched for it. What would make
        // a figure depend on the outside world is a `href`, a `url(...)` or an
        // embedded `<image>`, so those are what is checked.
        println!(
            "{name:<34} source={points:>7} svg_bytes={:>9} svg_elements={:>5} \
             finite_only={} chrome_free={} external_free={}",
            document.len(),
            count_elements(&document),
            !document.contains("NaN") && !document.contains("inf"),
            !document.contains("class="),
            !document.contains("href")
                && !document.contains("url(")
                && !document.contains("<image"),
        );
    }

    println!();
    println!("## determinism");
    let scene = &scenes[0];
    let figure = figure_of(
        scene,
        DataScope::FullSource,
        scene.x.clone(),
        scene.y.clone(),
    );
    let first = svg::render(&figure);
    let second = svg::render(&figure);
    println!("byte-identical across two renders: {}", first == second);
    let json = figure.to_json().expect("a figure serializes");
    let decoded = FigureSpec::from_json(&json).expect("and decodes");
    println!(
        "round-trips through JSON and renders identically: {}",
        svg::render(&decoded) == first
    );
    println!("figure json bytes: {}", json.len());
}
