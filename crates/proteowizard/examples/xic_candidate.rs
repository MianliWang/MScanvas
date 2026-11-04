//! Unstable, developer-only evidence adapter for the XIC pass (ADR 0071, X2).
//!
//! `cargo run -p mscanvas-proteowizard --release --example xic_candidate --
//! SOURCE MS_LEVEL LOW HIGH SNAPSHOT MODE`
//!
//! The frozen PX.3 runners score what this prints against answers derived from
//! the source bytes alone. It writes one JSON object to stdout:
//!
//! - **Snapshot.** The source is copied to `SNAPSHOT`, which must not exist, and
//!   everything below reads that copy, so the snapshot is the exact bytes read.
//! - **`normal`.** The scored rows come from [`read_xic`], the production entry
//!   point, unchanged. The frozen answers also state each row's point positions,
//!   which the product has no use for and `XicResult` does not hold, so a second
//!   pass over the same bytes records them through a transform that changes
//!   nothing, and the two results must be equal.
//! - **`source_metadata`** is echoed with raw attributes and origins by its own
//!   small walk over the snapshot, as ADR 0046's PX.1 clarification asks and as
//!   PX.3's candidate did. Rows and metadata must name the same scans in the same
//!   order, or the query is refused as `ScanCorrespondenceMismatch`.
//! - **Faults.** `fault-identity` breaks that correspondence, `narrow-intensity`
//!   and `substitute-normalized` run the generic pass with a transform that alters
//!   the science. They exist only here. The product instantiates only `XicIdentity`
//!   and no feature or flag reaches them (ADR 0071 decision 8).
//! - **`observe`** is not scored: `read_xic` on the source itself, no snapshot and
//!   no echo, for the release resource observations.
//!
//! New facts stay at top level, because the frozen comparator matches `rows`,
//! `observation` and `source_metadata` exactly and drops extra top-level keys.

use std::collections::HashMap;
use std::fmt::Write as _;
use std::fs::File;
use std::io::{self, BufReader, Write as _};
use std::path::Path;
use std::process::ExitCode;
use std::time::Instant;

use mscanvas_proteowizard::{
    ArrayRole, MzmlDeclared, MzmlPolarity, MzmlRepresentation, MzmlScanLimits, XIC_QUANTITY,
    XicAxis, XicQuery, XicRefusal, XicResult, XicScan, XicScanState, XicSpectrumTransform, XicUnit,
    read_xic, read_xic_from,
};
use quick_xml::events::{BytesStart, Event};
use quick_xml::name::ResolveResult;
use quick_xml::{NsReader, XmlVersion};

const MZML_NAMESPACE: &[u8] = b"http://psi.hupo.org/ms/mzml";

fn main() -> ExitCode {
    let args: Vec<String> = std::env::args().collect();
    let [_, source, level, low, high, snapshot, mode] = args.as_slice() else {
        eprintln!("usage: xic_candidate SOURCE MS_LEVEL LOW HIGH SNAPSHOT MODE");
        return ExitCode::from(2);
    };
    let Some(mode) = Mode::parse(mode) else {
        eprintln!("unknown mode: {mode}");
        return ExitCode::from(2);
    };
    let bounds = Bounds {
        // An unreadable operand is an invalid query, as the frozen answers say.
        level: level.parse().unwrap_or(0),
        low: low.parse().unwrap_or(f64::NAN),
        high: high.parse().unwrap_or(f64::NAN),
    };
    match run(Path::new(source), bounds, Path::new(snapshot), mode) {
        Ok(json) => {
            let mut stdout = io::stdout().lock();
            match stdout
                .write_all(json.as_bytes())
                .and_then(|()| stdout.flush())
            {
                Ok(()) => ExitCode::SUCCESS,
                Err(error) => {
                    eprintln!("stdout: {error}");
                    ExitCode::from(3)
                }
            }
        }
        Err(error) => {
            eprintln!("operational failure: {error}");
            ExitCode::from(3)
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Normal,
    FaultIdentity,
    NarrowIntensity,
    SubstituteNormalized,
    Observe,
}

impl Mode {
    fn parse(text: &str) -> Option<Self> {
        match text {
            "normal" => Some(Self::Normal),
            "fault-identity" => Some(Self::FaultIdentity),
            "narrow-intensity" => Some(Self::NarrowIntensity),
            "substitute-normalized" => Some(Self::SubstituteNormalized),
            "observe" => Some(Self::Observe),
            _ => None,
        }
    }
}

#[derive(Clone, Copy)]
struct Bounds {
    level: u32,
    low: f64,
    high: f64,
}

fn run(source: &Path, bounds: Bounds, snapshot: &Path, mode: Mode) -> Result<String, String> {
    if mode == Mode::Observe {
        return observe(source, bounds);
    }
    copy_new(source, snapshot).map_err(|error| format!("snapshot: {error}"))?;
    let Ok(query) = XicQuery::from_bounds(bounds.level, bounds.low, bounds.high) else {
        return Ok(refused(&XicRefusal::InvalidQuery, None));
    };
    let limits = MzmlScanLimits::default();

    let mut recorder = Recorder::new(bounds, mode);
    let reader = BufReader::new(File::open(snapshot).map_err(|error| error.to_string())?);
    let started = Instant::now();
    let (outcome, pass_seconds) =
        if matches!(mode, Mode::NarrowIntensity | Mode::SubstituteNormalized) {
            let outcome = read_xic_from(reader, &query, limits, &mut recorder, || false);
            (outcome, started.elapsed().as_secs_f64())
        } else {
            let outcome = read_xic(snapshot, &query, limits, || false);
            let pass_seconds = started.elapsed().as_secs_f64();
            let recorded = read_xic_from(reader, &query, limits, &mut recorder, || false);
            if recorded != outcome {
                return Err("the recording pass differs from the production pass".to_owned());
            }
            (outcome, pass_seconds)
        };

    let result = match outcome {
        Ok(result) => result,
        Err(refusal) => {
            let echo = match refusal {
                XicRefusal::IncompleteUnit(_)
                | XicRefusal::MixedUnit(_)
                | XicRefusal::MixedPolarity
                | XicRefusal::MixedFaimsCompensationVoltage
                | XicRefusal::MixedRepresentation => Some(echo_metadata(snapshot)?),
                _ => None,
            };
            return Ok(refused(
                &refusal,
                echo.as_ref().map(|echo| echo.json.as_str()),
            ));
        }
    };

    let echo = echo_metadata(snapshot)?;
    let mut scans: Vec<(u64, String)> = result.rows().iter().map(row_identity).collect();
    if mode == Mode::FaultIdentity
        && let Some(first) = scans.first_mut()
    {
        "injected-wrong-id".clone_into(&mut first.1);
    }
    if scans != echo.scans {
        let mut out = String::from(
            r#"{"status":"Refused","reason":"ScanCorrespondenceMismatch","complete":false,"source_metadata":"#,
        );
        out.push_str(&echo.json);
        out.push_str("}\n");
        return Ok(out);
    }
    evaluated(&result, &recorder, &echo.json, pass_seconds)
}

fn copy_new(source: &Path, snapshot: &Path) -> io::Result<()> {
    let mut from = File::open(source)?;
    let mut to = File::create_new(snapshot)?;
    io::copy(&mut from, &mut to)?;
    to.sync_all()
}

fn observe(source: &Path, bounds: Bounds) -> Result<String, String> {
    let query = XicQuery::from_bounds(bounds.level, bounds.low, bounds.high)
        .map_err(|refusal| refusal.stable_id().to_owned())?;
    let started = Instant::now();
    let result = read_xic(source, &query, MzmlScanLimits::default(), || false)
        .map_err(|refusal| refusal.stable_id().to_owned())?;
    let pass_seconds = started.elapsed().as_secs_f64();
    let rows = result.rows();
    let measured = rows
        .iter()
        .filter(|row| matches!(row.state(), XicScanState::Measured { .. }))
        .count();
    let points: u64 = rows
        .iter()
        .map(|row| match row.state() {
            XicScanState::Measured {
                points_in_window, ..
            } => points_in_window,
            _ => 0,
        })
        .sum();
    let decoded = rows.iter().filter(|row| row.decode_attempted()).count();
    Ok(format!(
        concat!(
            r#"{{"pass_wall_seconds":{:?},"rows":{},"decoded_scans":{},"measured_scans":{},"#,
            r#""points_in_window":{},"coverage_gaps":{},"inline_bytes_per_row":{},"representation":"{}"}}"#,
            "\n"
        ),
        pass_seconds,
        rows.len(),
        decoded,
        measured,
        points,
        result.coverage_gaps(),
        std::mem::size_of::<XicScan>(),
        representation_name(result.representation()),
    ))
}

/// Writes each evaluated spectrum's in-window positions down and, in a fault mode
/// only, alters the science.
struct Recorder {
    bounds: Bounds,
    mode: Mode,
    positions: Vec<Vec<usize>>,
}

impl Recorder {
    const fn new(bounds: Bounds, mode: Mode) -> Self {
        Self {
            bounds,
            mode,
            positions: Vec::new(),
        }
    }
}

impl XicSpectrumTransform for Recorder {
    fn apply(&mut self, retention_time: &mut Option<f64>, mz: &mut [f64], intensity: &mut [f64]) {
        match self.mode {
            Mode::NarrowIntensity => {
                for value in intensity.iter_mut() {
                    *value = f64::from(*value as f32);
                }
            }
            // The reversal PX.3 called `candidate_normalized_rt`: a time in the
            // reader's own unit in place of the one declared.
            Mode::SubstituteNormalized => *retention_time = retention_time.map(|rt| rt / 60.0),
            _ => {}
        }
        let (low, high) = (self.bounds.low, self.bounds.high);
        self.positions.push(
            mz.iter()
                .enumerate()
                .filter(|(_, position)| low <= **position && **position <= high)
                .map(|(at, _)| at)
                .collect(),
        );
    }
}

fn row_identity(row: &XicScan) -> (u64, String) {
    let identity = row.identity();
    let id = identity
        .representations()
        .first()
        .map_or_else(String::new, |raw| raw.sensitive_raw().to_owned());
    (identity.index(), id)
}

// ---------------------------------------------------------------------------
// The result, as the frozen comparator reads it
// ---------------------------------------------------------------------------

fn evaluated(
    result: &XicResult,
    recorder: &Recorder,
    metadata: &str,
    pass_seconds: f64,
) -> Result<String, String> {
    let query = result.query();
    let mut out = String::new();
    write!(
        out,
        concat!(
            r#"{{"status":"Evaluated","complete":{},"all_source_scans_observed":true,"#,
            r#""coverage_gaps":{},"query":{{"ms_level":{},"low":{:?},"high":{:?}}},"source_metadata":"#
        ),
        result.is_complete(),
        result.coverage_gaps(),
        query.ms_level(),
        query.low(),
        query.high(),
    )
    .map_err(|error| error.to_string())?;
    out.push_str(metadata);
    out.push_str(r#","rows":["#);

    let mut recorded = recorder.positions.iter();
    let mut unreadable = String::new();
    for (at, row) in result.rows().iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        let (index, id) = row_identity(row);
        write!(out, r#"{{"index":{index},"id":"#).map_err(|error| error.to_string())?;
        push_string(&mut out, &id);
        out.push_str(r#","rt":"#);
        push_number(&mut out, row.retention_time());
        out.push_str(r#","rt_unit":"#);
        push_unit(&mut out, result.retention_time_unit());
        out.push_str(r#","ms_level":"#);
        match row.ms_level() {
            Some(level) => write!(out, "{level}").map_err(|error| error.to_string())?,
            None => out.push_str("null"),
        }
        out.push_str(r#","representation":"#);
        out.push_str(match row.representation() {
            MzmlRepresentation::Centroid => r#""Centroid""#,
            MzmlRepresentation::Profile => r#""Profile""#,
            MzmlRepresentation::NotDeclared => "null",
        });
        out.push_str(r#","observation":{"state":"#);
        match row.state() {
            XicScanState::Measured {
                sum,
                points_in_window,
            } => {
                let positions = recorded
                    .next()
                    .ok_or("a measured row has no recorded positions")?;
                if positions.len() as u64 != points_in_window {
                    return Err("recorded positions disagree with the row's count".to_owned());
                }
                write!(
                    out,
                    r#""Measured","sum":{sum:?},"sum_bits":"{:016x}","points_in_window":{points_in_window},"positions":{positions:?},"intensity_unit":"#,
                    sum.to_bits(),
                )
                .map_err(|error| error.to_string())?;
                push_unit(&mut out, result.intensity_unit());
                write!(out, r#","quantity":"{XIC_QUANTITY}""#)
                    .map_err(|error| error.to_string())?;
            }
            XicScanState::NonFiniteIntensity => {
                recorded.next();
                out.push_str(r#""NonFiniteIntensity""#);
            }
            XicScanState::SumNotRepresentable => {
                recorded.next();
                out.push_str(r#""SumNotRepresentable""#);
            }
            XicScanState::ExcludedByMsLevel => out.push_str(r#""ExcludedByMsLevel""#),
            XicScanState::MsLevelUndeclared => out.push_str(r#""MsLevelUndeclared""#),
            XicScanState::NoUsableArrays => out.push_str(r#""NoUsableArrays""#),
            XicScanState::Missing => out.push_str(r#""Missing""#),
            XicScanState::Unreadable { role, reason } => {
                out.push_str(r#""Unreadable""#);
                if !unreadable.is_empty() {
                    unreadable.push(',');
                }
                let role = match role {
                    ArrayRole::Mz => "Mz",
                    ArrayRole::Intensity => "Intensity",
                };
                write!(
                    unreadable,
                    r#"{{"index":{index},"role":"{role}","reason":"{}"}}"#,
                    reason.stable_id()
                )
                .map_err(|error| error.to_string())?;
            }
        }
        write!(
            out,
            r#"}},"coverage_gap":{},"decode_attempts":{}}}"#,
            row.is_coverage_gap(),
            u8::from(row.decode_attempted()),
        )
        .map_err(|error| error.to_string())?;
    }
    if recorded.next().is_some() {
        return Err("more spectra were recorded than rows reached the window".to_owned());
    }

    out.push_str(r#"],"disclosures":{"mz_unit":"#);
    push_unit(&mut out, result.mz_unit());
    write!(
        out,
        r#","representation":"{}","polarity":"{}","faims_compensation_voltage":"#,
        representation_name(result.representation()),
        polarity_name(result.polarity()),
    )
    .map_err(|error| error.to_string())?;
    push_number(&mut out, result.faims_compensation_voltage());
    write!(
        out,
        r#","scans_outside_scan_window":{},"scan_windows_differ":{},"unreadable":[{unreadable}]}},"pass_wall_seconds":{pass_seconds:?}}}"#,
        result.scans_outside_scan_window(),
        result.scan_windows_differ(),
    )
    .map_err(|error| error.to_string())?;
    out.push('\n');
    Ok(out)
}

fn refused(refusal: &XicRefusal, metadata: Option<&str>) -> String {
    let axis_name = |axis: XicAxis| match axis {
        XicAxis::Mz => "Mz",
        XicAxis::Intensity => "Intensity",
        XicAxis::RetentionTime => "RT",
    };
    let category = match refusal {
        XicRefusal::InvalidQuery => "InvalidQuery".to_owned(),
        XicRefusal::IncompleteUnit(axis) => format!("IncompleteUnit:{}", axis_name(*axis)),
        XicRefusal::MixedUnit(axis) => format!("MixedUnit:{}", axis_name(*axis)),
        XicRefusal::MixedPolarity => "MixedPolarity".to_owned(),
        XicRefusal::MixedFaimsCompensationVoltage => "MixedFaimsCompensationVoltage".to_owned(),
        XicRefusal::MixedRepresentation => "MixedRepresentation".to_owned(),
        XicRefusal::Cancelled => "Cancelled".to_owned(),
        XicRefusal::Document(_) | XicRefusal::MalformedMetadata(_) => {
            "MalformedMetadata".to_owned()
        }
    };
    let mut out = format!(
        r#"{{"status":"Refused","category":"{category}","reason":"{}","complete":false"#,
        refusal.stable_id()
    );
    if let Some(metadata) = metadata {
        out.push_str(r#","source_metadata":"#);
        out.push_str(metadata);
    }
    out.push_str("}\n");
    out
}

const fn representation_name(representation: MzmlRepresentation) -> &'static str {
    match representation {
        MzmlRepresentation::Centroid => "Centroid",
        MzmlRepresentation::Profile => "Profile",
        MzmlRepresentation::NotDeclared => "NotDeclared",
    }
}

const fn polarity_name(polarity: MzmlDeclared<MzmlPolarity>) -> &'static str {
    match polarity {
        MzmlDeclared::Value(MzmlPolarity::Positive) => "Positive",
        MzmlDeclared::Value(MzmlPolarity::Negative) => "Negative",
        _ => "NotDeclared",
    }
}

fn push_unit(out: &mut String, unit: &XicUnit) {
    push_unit_parts(out, unit.accession(), unit.name(), unit.cv_ref());
}

fn push_unit_parts(
    out: &mut String,
    accession: Option<&str>,
    name: Option<&str>,
    cv_ref: Option<&str>,
) {
    out.push_str(r#"{"unit_accession":"#);
    push_optional(out, accession);
    out.push_str(r#","unit_name":"#);
    push_optional(out, name);
    out.push_str(r#","unit_cv_ref":"#);
    push_optional(out, cv_ref);
    out.push('}');
}

fn push_optional(out: &mut String, value: Option<&str>) {
    match value {
        Some(value) => push_string(out, value),
        None => out.push_str("null"),
    }
}

/// `{:?}` always writes a fraction or an exponent, so Python reads a float. An
/// integer-looking value would compare exactly against the frozen float and fail.
fn push_number(out: &mut String, value: Option<f64>) {
    match value {
        Some(value) => {
            let _ = write!(out, "{value:?}");
        }
        None => out.push_str("null"),
    }
}

fn push_string(out: &mut String, value: &str) {
    out.push('"');
    for character in value.chars() {
        match character {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            control if u32::from(control) < 0x20 => {
                let _ = write!(out, "\\u{:04x}", u32::from(control));
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

// ---------------------------------------------------------------------------
// The metadata echo
// ---------------------------------------------------------------------------

#[derive(Clone)]
struct Param {
    attributes: Vec<(String, String)>,
    origin: String,
}

impl Param {
    fn get(&self, key: &str) -> Option<&str> {
        self.attributes
            .iter()
            .find(|(name, _)| name == key)
            .map(|(_, value)| value.as_str())
    }

    fn accession_in(&self, accessions: &[&str]) -> bool {
        self.get("accession")
            .is_some_and(|accession| accessions.contains(&accession))
    }
}

#[derive(Default)]
struct OpenScan {
    index: u64,
    id: String,
    default_array_length: u64,
    spectrum: Vec<Param>,
    scan: Vec<Param>,
    arrays: Vec<Vec<Param>>,
}

struct Echo {
    json: String,
    scans: Vec<(u64, String)>,
}

fn attributes(start: &BytesStart<'_>) -> Result<Vec<(String, String)>, String> {
    start
        .attributes()
        .map(|attribute| {
            let attribute = attribute.map_err(|error| error.to_string())?;
            let key = String::from_utf8_lossy(attribute.key.as_ref()).into_owned();
            let value = attribute
                .normalized_value(XmlVersion::Implicit1_0)
                .map_err(|error| error.to_string())?
                .into_owned();
            Ok((key, value))
        })
        .collect()
}

fn attribute<'a>(attributes: &'a [(String, String)], key: &str) -> Option<&'a str> {
    attributes
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, value)| value.as_str())
}

/// Every `cvParam` and param-group reference directly inside a spectrum, its scans
/// and its arrays, as stated and in source order. It judges nothing: the pass has
/// already judged this document.
fn echo_metadata(snapshot: &Path) -> Result<Echo, String> {
    let file = File::open(snapshot).map_err(|error| error.to_string())?;
    let mut reader = NsReader::from_reader(BufReader::with_capacity(64 * 1024, file));
    let mut buffer = Vec::new();
    let mut stack: Vec<String> = Vec::new();
    let mut groups: HashMap<String, Vec<Param>> = HashMap::new();
    let mut open_group: Option<(String, Vec<Param>)> = None;
    let mut open_scan: Option<OpenScan> = None;
    let mut echo = Echo {
        json: String::from("["),
        scans: Vec::new(),
    };
    loop {
        buffer.clear();
        let (namespace, event) = reader
            .read_resolved_event_into(&mut buffer)
            .map_err(|error| error.to_string())?;
        let (start, empty) = match event {
            Event::Start(start) => (start, false),
            Event::Empty(start) => (start, true),
            Event::End(_) => {
                close(
                    &mut stack,
                    &mut groups,
                    &mut open_group,
                    &mut open_scan,
                    &mut echo,
                )?;
                continue;
            }
            Event::Eof => break,
            _ => continue,
        };
        let ours =
            matches!(namespace, ResolveResult::Bound(bound) if bound.as_ref() == MZML_NAMESPACE);
        let local = String::from_utf8_lossy(start.local_name().as_ref()).into_owned();
        let name = if ours { local } else { String::new() };
        visit(
            &name,
            &start,
            &stack,
            &groups,
            &mut open_group,
            &mut open_scan,
        )?;
        stack.push(name);
        if empty {
            close(
                &mut stack,
                &mut groups,
                &mut open_group,
                &mut open_scan,
                &mut echo,
            )?;
        }
    }
    echo.json.push(']');
    Ok(echo)
}

fn visit(
    name: &str,
    start: &BytesStart<'_>,
    stack: &[String],
    groups: &HashMap<String, Vec<Param>>,
    open_group: &mut Option<(String, Vec<Param>)>,
    open_scan: &mut Option<OpenScan>,
) -> Result<(), String> {
    let parent = stack.last().map_or("", String::as_str);
    match name {
        "referenceableParamGroup" if parent == "referenceableParamGroupList" => {
            let attributes = attributes(start)?;
            let id = attribute(&attributes, "id").unwrap_or_default().to_owned();
            *open_group = Some((id, Vec::new()));
        }
        "spectrum" if parent == "spectrumList" => {
            let attributes = attributes(start)?;
            let number = |key| {
                attribute(&attributes, key)
                    .and_then(|value| value.parse().ok())
                    .ok_or_else(|| format!("spectrum without {key}"))
            };
            *open_scan = Some(OpenScan {
                index: number("index")?,
                id: attribute(&attributes, "id").unwrap_or_default().to_owned(),
                default_array_length: number("defaultArrayLength")?,
                ..OpenScan::default()
            });
        }
        "binaryDataArray" if parent == "binaryDataArrayList" => {
            if let Some(scan) = open_scan.as_mut() {
                scan.arrays.push(Vec::new());
            }
        }
        "cvParam" | "referenceableParamGroupRef" => {
            let attributes = attributes(start)?;
            let found = if name == "cvParam" {
                let origin = match open_group {
                    Some((id, _)) if parent == "referenceableParamGroup" => format!("group:{id}"),
                    _ => "direct".to_owned(),
                };
                vec![Param { attributes, origin }]
            } else {
                let reference = attribute(&attributes, "ref").unwrap_or_default();
                groups.get(reference).cloned().unwrap_or_default()
            };
            let target = match (parent, open_scan.as_mut(), open_group.as_mut()) {
                ("referenceableParamGroup", _, Some((_, params))) => Some(params),
                ("spectrum", Some(scan), _) => Some(&mut scan.spectrum),
                ("scan", Some(scan), _) => Some(&mut scan.scan),
                ("binaryDataArray", Some(scan), _) => scan.arrays.last_mut(),
                _ => None,
            };
            if let Some(target) = target {
                target.extend(found);
            }
        }
        _ => {}
    }
    Ok(())
}

fn close(
    stack: &mut Vec<String>,
    groups: &mut HashMap<String, Vec<Param>>,
    open_group: &mut Option<(String, Vec<Param>)>,
    open_scan: &mut Option<OpenScan>,
    echo: &mut Echo,
) -> Result<(), String> {
    let name = stack.pop().ok_or("an end tag with nothing open")?;
    let parent = stack.last().map_or("", String::as_str);
    match name.as_str() {
        "referenceableParamGroup" if parent == "referenceableParamGroupList" => {
            if let Some((id, params)) = open_group.take() {
                groups.insert(id, params);
            }
        }
        "spectrum" if parent == "spectrumList" => {
            if let Some(scan) = open_scan.take() {
                if !echo.scans.is_empty() {
                    echo.json.push(',');
                }
                push_scan(&mut echo.json, &scan)?;
                echo.scans.push((scan.index, scan.id));
            }
        }
        _ => {}
    }
    Ok(())
}

fn first<'a>(params: &'a [Param], accessions: &[&str]) -> Option<&'a Param> {
    params.iter().find(|param| param.accession_in(accessions))
}

fn push_declared_unit(out: &mut String, param: Option<&Param>) {
    let get = |key| param.and_then(|param| param.get(key));
    push_unit_parts(out, get("unitAccession"), get("unitName"), get("unitCvRef"));
}

fn push_params(out: &mut String, params: &[Param]) {
    out.push('[');
    for (at, param) in params.iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        out.push_str(r#"{"attributes":{"#);
        for (place, (key, value)) in param.attributes.iter().enumerate() {
            if place > 0 {
                out.push(',');
            }
            push_string(out, key);
            out.push(':');
            push_string(out, value);
        }
        out.push_str(r#"},"origin":"#);
        push_string(out, &param.origin);
        out.push('}');
    }
    out.push(']');
}

fn push_scan(out: &mut String, scan: &OpenScan) -> Result<(), String> {
    write!(out, r#"{{"index":{},"id":"#, scan.index).map_err(|error| error.to_string())?;
    push_string(out, &scan.id);
    write!(
        out,
        r#","default_array_length":{},"ms_level":"#,
        scan.default_array_length
    )
    .map_err(|error| error.to_string())?;
    match first(&scan.spectrum, &["MS:1000511"]).and_then(|param| param.get("value")) {
        Some(value) => {
            let level: u64 = value
                .parse()
                .map_err(|_| "an MS level the pass admitted is not a number")?;
            write!(out, "{level}").map_err(|error| error.to_string())?;
        }
        None => out.push_str("null"),
    }
    out.push_str(r#","representation":"#);
    out.push_str(
        match first(&scan.spectrum, &["MS:1000127", "MS:1000128"])
            .and_then(|param| param.get("accession"))
        {
            Some("MS:1000128") => r#""Profile""#,
            Some(_) => r#""Centroid""#,
            None => "null",
        },
    );
    let time = first(&scan.scan, &["MS:1000016"]);
    let text = time.and_then(|param| param.get("value"));
    out.push_str(r#","rt_value":"#);
    push_number(out, text.and_then(|text| text.trim().parse().ok()));
    out.push_str(r#","rt_source_value":"#);
    push_optional(out, text);
    out.push_str(r#","rt_unit":"#);
    push_declared_unit(out, time);
    out.push_str(r#","spectrum_parameters":"#);
    push_params(out, &scan.spectrum);
    out.push_str(r#","scan_parameters":"#);
    push_params(out, &scan.scan);
    out.push_str(r#","arrays":["#);
    for (at, params) in scan.arrays.iter().enumerate() {
        if at > 0 {
            out.push(',');
        }
        let role = first(params, &["MS:1000514", "MS:1000515", "MS:1000595"]);
        out.push_str(r#"{"role":"#);
        out.push_str(match role.and_then(|param| param.get("accession")) {
            Some("MS:1000514") => r#""Mz""#,
            Some("MS:1000515") => r#""Intensity""#,
            Some(_) => r#""Time""#,
            None => "null",
        });
        out.push_str(r#","unit":"#);
        push_declared_unit(out, role);
        out.push_str(r#","parameters":"#);
        push_params(out, params);
        out.push('}');
    }
    out.push_str("]}");
    Ok(())
}
