//! Unstable, developer-only measurement of the RT × m/z map (ADR 0068).
//!
//! It reads one mzML file's spectrum table, maps its MS1 spectra over their
//! whole extent and over one zoomed view, and prints wall times and counts. It
//! also prints the median spacing of adjacent m/z samples in three ranges of
//! the MS1 spectrum with the most points, which is what makes a sum per
//! fixed-width bin depend on sampling density. The zoomed view is the middle
//! tenth of each axis. Peak memory is read from outside the process. Output is
//! path-free.
//!
//! ```text
//! cargo run --release -p mscanvas-proteowizard --example rt_mz_map_evidence -- <file.mzML>
//! ```
//!
//! This example is intentionally not a stable MSCanvas CLI contract.

use std::error::Error;
use std::path::Path;
use std::time::Instant;

use mscanvas_proteowizard::{
    CancellationToken, MapRequest, MzmlRepresentation, MzmlScanLimits, MzmlSpectrumTable,
    bin_rt_mz_map, ms1_extent, read_selected_spectrum, read_spectrum_table,
};

fn main() -> Result<(), Box<dyn Error>> {
    let path = std::env::args_os()
        .nth(1)
        .ok_or("usage: rt_mz_map_evidence <file.mzML>")?;
    let path = Path::new(&path);

    let started = Instant::now();
    let table = read_spectrum_table(path, MzmlScanLimits::default())?;
    println!(
        "table: {} rows, {:.0} ms",
        table.rows().len(),
        started.elapsed().as_secs_f64() * 1e3
    );
    let extent = ms1_extent(&table)?;
    let mz = extent
        .mz()
        .ok_or("not every MS1 spectrum states its observed m/z range")?;
    println!(
        "extent: {} MS1 spectra, retention time {:?} {:?}, m/z {mz:?}",
        extent.spectra(),
        extent.retention_time(),
        extent.retention_time_unit()
    );

    let full = MapRequest {
        retention_time: extent.retention_time(),
        mz,
        retention_time_bins: 1024,
        mz_bins: 2048,
    };
    measure("full", path, &table, full)?;
    // The middle tenth of each axis.
    let tenth = |(low, high): (f64, f64)| {
        let (middle, half) = ((low + high) / 2.0, (high - low) / 20.0);
        (middle - half, middle + half)
    };
    let zoomed = MapRequest {
        retention_time: tenth(full.retention_time),
        mz: tenth(mz),
        ..full
    };
    measure("zoomed", path, &table, zoomed)?;
    spacing(path, &table)
}

fn measure(
    label: &str,
    path: &Path,
    table: &MzmlSpectrumTable,
    request: MapRequest,
) -> Result<(), Box<dyn Error>> {
    let started = Instant::now();
    let map = bin_rt_mz_map(path, table, request, &CancellationToken::new(), |_, _| {})?;
    let elapsed = started.elapsed().as_secs_f64() * 1e3;
    let filled = (0..request.retention_time_bins)
        .flat_map(|time| (0..request.mz_bins).map(move |mz| (time, mz)))
        .filter(|&(time, mz)| map.cell(time, mz).is_some())
        .count();
    println!(
        "{label}: {} profile, {} centroid, {} undeclared spectra; {} points binned, {} outside m/z; \
         {filled} of {} cells hold a value; {elapsed:.0} ms",
        map.spectra(MzmlRepresentation::Profile),
        map.spectra(MzmlRepresentation::Centroid),
        map.spectra(MzmlRepresentation::NotDeclared),
        map.points_binned(),
        map.points_outside_mz(),
        u64::from(request.retention_time_bins) * u64::from(request.mz_bins),
    );
    Ok(())
}

fn spacing(path: &Path, table: &MzmlSpectrumTable) -> Result<(), Box<dyn Error>> {
    let Some(index) = table
        .rows()
        .iter()
        .filter(|row| row.ms_level() == 1)
        .max_by_key(|row| row.default_array_length())
        .map(|row| row.identity().index())
    else {
        return Ok(());
    };
    let spectrum = read_selected_spectrum(path, table, index)?;
    let mz = spectrum.mz().values();
    println!("largest MS1 spectrum: {} points", mz.len());
    for (low, high) in [(400.0, 500.0), (800.0, 900.0), (1200.0, 1300.0)] {
        let mut gaps: Vec<f64> = mz
            .windows(2)
            .filter(|pair| pair[0] >= low && pair[1] < high)
            .map(|pair| pair[1] - pair[0])
            .collect();
        gaps.sort_by(f64::total_cmp);
        let median = gaps.get(gaps.len() / 2).copied();
        println!(
            "m/z {low}-{high}: {} adjacent pairs, median spacing {median:?}",
            gaps.len()
        );
    }
    Ok(())
}
