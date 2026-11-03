//! Where an axis is labelled, and what each label says.
//!
//! Ticks at round numbers -- one, two or five times a power of ten -- because
//! that is how a scientific axis is read: a reader interpolates between `20`
//! and `40`, not between `17.384` and `93.207`. The domain ends are not
//! labelled; they are wherever the data puts them, and the ticks say how far
//! that is.
//!
//! **Every tick is an integer times its step, in decimal.** The value is parsed
//! from the decimal string `k × m e x`, so `0.3` is the `f64` nearest three
//! tenths rather than `3 × 0.1`, which is not; and the label is written from the
//! same integers, so no label ever prints a binary rounding artefact and no
//! label is ever negative zero. Where those integers stop being exact -- a span
//! narrow beside its own magnitude -- there are no nice ticks to offer, and the
//! caller falls back to labelling the ends.

use crate::spec::Domain;

/// How many ticks an axis aims for.
///
/// Four to six read as a scale; a 1-2-5 sequence cannot hit that band for every
/// span, so the count nearest five wins and a cramped axis takes fewer.
const TARGET_TICKS: usize = 5;

/// Past this many, a finer step only adds labels.
const MAX_TICKS: usize = 12;

/// The largest integer an `f64` holds exactly.
const EXACT_INTEGER: f64 = 9_007_199_254_740_992.0;

/// The longest a fixed-point tick label may be before the axis uses exponents.
const MAX_FIXED_CHARS: usize = 12;

/// One labelled position on an axis.
#[derive(Debug, Clone, PartialEq)]
pub(crate) struct Tick {
    pub(crate) at: f64,
    pub(crate) label: String,
}

/// The nice ticks for `domain`, or `None` where it has none to give.
///
/// `fits` is asked of each candidate set, coarsest first, and says whether its
/// labels can be drawn without colliding; of those that fit, the count nearest
/// [`TARGET_TICKS`] is chosen, and the coarser of two equally near. At least two
/// ticks or nothing: one tick is a position, not a scale.
pub(crate) fn nice_ticks(domain: Domain, fits: impl Fn(&[Tick]) -> bool) -> Option<Vec<Tick>> {
    let (low, high) = (domain.low(), domain.high());
    let span = domain.span();
    if span <= 0.0 || !span.is_finite() {
        return None;
    }
    #[expect(
        clippy::cast_possible_truncation,
        reason = "the log of a finite positive f64 is within a few hundred"
    )]
    let top = span.log10().floor() as i32 + 1;
    let mut best: Option<(usize, Vec<Tick>)> = None;
    for exponent in (top - 4..=top).rev() {
        for mantissa in [5_i64, 2, 1] {
            let step: f64 = format!("{mantissa}e{exponent}").parse().ok()?;
            if !step.is_finite() || step == 0.0 {
                continue;
            }
            // One step beyond each end, and then held to the domain by the
            // parsed value: a quotient one ulp either side of an integer must
            // neither drop a tick on the end nor add one past it.
            let first = (low / step).floor() - 1.0;
            let last = (high / step).ceil() + 1.0;
            // A finer step only needs larger integers, so past this point no
            // candidate is exact -- but a coarser one already found still is.
            if !first.is_finite()
                || !last.is_finite()
                || first.abs() > EXACT_INTEGER / 8.0
                || last.abs() > EXACT_INTEGER / 8.0
            {
                return best.map(|(_, ticks)| ticks);
            }
            #[expect(
                clippy::cast_possible_truncation,
                reason = "bounded above by an exact integer"
            )]
            let (first, last) = (first as i64, last as i64);
            let Some(candidate) = candidate(low, high, first, last, mantissa, exponent) else {
                return best.map(|(_, ticks)| ticks);
            };
            if candidate.len() > MAX_TICKS {
                return best.map(|(_, ticks)| ticks);
            }
            if candidate.len() < 2 || !fits(&candidate) {
                continue;
            }
            let score = candidate.len().abs_diff(TARGET_TICKS);
            if best.as_ref().is_none_or(|(held, _)| score < *held) {
                best = Some((score, candidate));
            }
        }
    }
    best.map(|(_, ticks)| ticks)
}

/// The ticks `k × mantissa × 10^exponent` for `k` in `first..=last`, inside the
/// domain, or `None` where two of them parse to one `f64`.
fn candidate(
    low: f64,
    high: f64,
    first: i64,
    last: i64,
    mantissa: i64,
    exponent: i32,
) -> Option<Vec<Tick>> {
    let mut kept: Vec<(i64, f64)> = Vec::new();
    for k in first..=last {
        let integer = k * mantissa;
        let at: f64 = format!("{integer}e{exponent}").parse().ok()?;
        if at < low || at > high {
            continue;
        }
        if kept.last().is_some_and(|(_, previous)| *previous >= at) {
            return None;
        }
        kept.push((integer, at));
    }
    let integers: Vec<i64> = kept.iter().map(|(integer, _)| *integer).collect();
    let largest = kept.iter().map(|(_, at)| at.abs()).fold(0.0, f64::max);
    let fixed: Vec<String> = integers
        .iter()
        .map(|integer| fixed(*integer, exponent))
        .collect();
    let exponential = largest >= 1e6
        || (largest > 0.0 && largest < 1e-3)
        || fixed.iter().any(|label| label.len() > MAX_FIXED_CHARS);
    let labels: Vec<String> = if exponential {
        integers
            .iter()
            .map(|integer| scientific(*integer, exponent))
            .collect()
    } else {
        fixed
    };
    Some(
        kept.into_iter()
            .zip(labels)
            .map(|((_, at), label)| Tick { at, label })
            .collect(),
    )
}

/// `integer × 10^exponent` in fixed point, with the step's own decimals.
///
/// Every tick of one axis shares the exponent, so every label carries the same
/// number of decimals: `0.0, 0.5, 1.0`, never `0, 0.5, 1`.
fn fixed(integer: i64, exponent: i32) -> String {
    let sign = if integer < 0 { "-" } else { "" };
    let digits = integer.unsigned_abs().to_string();
    if exponent >= 0 {
        let zeros = "0".repeat(exponent.unsigned_abs() as usize);
        return if integer == 0 {
            "0".to_owned()
        } else {
            format!("{sign}{digits}{zeros}")
        };
    }
    let decimals = exponent.unsigned_abs() as usize;
    let padded = format!("{digits:0>width$}", width = decimals + 1);
    let (whole, fraction) = padded.split_at(padded.len() - decimals);
    format!("{sign}{whole}.{fraction}")
}

/// `integer × 10^exponent` as a shortest mantissa and an exponent: `2e6`,
/// `1.5e-7`, and `0` for zero.
fn scientific(integer: i64, exponent: i32) -> String {
    if integer == 0 {
        return "0".to_owned();
    }
    let sign = if integer < 0 { "-" } else { "" };
    let mut digits = integer.unsigned_abs().to_string();
    let mut exponent = exponent;
    while digits.len() > 1 && digits.ends_with('0') {
        digits.pop();
        exponent += 1;
    }
    #[expect(
        clippy::cast_possible_truncation,
        clippy::cast_possible_wrap,
        reason = "an i64 has at most nineteen digits"
    )]
    let power = exponent + digits.len() as i32 - 1;
    let mantissa = if digits.len() == 1 {
        digits
    } else {
        format!("{}.{}", &digits[..1], &digits[1..])
    };
    format!("{sign}{mantissa}e{power}")
}

/// The table the screen's `niceTicks` is held to: `plotAxes.test.ts` reads the
/// same file and expects the same ticks, under a `fits` that always says yes
/// because the screen has no collision check.
///
/// `MSCANVAS_WRITE_TICK_TABLE=1 cargo test -p mscanvas-plot-spec shared_table`
/// rewrites the file; otherwise a difference fails, and a missing file with it.
#[cfg(test)]
mod shared_table {
    use super::*;

    const RANGES: &[(f64, f64)] = &[
        // Ordinary spans, this module's tests' and the screen's.
        (0.0, 94.5),
        (100.5, 500.0),
        (0.0, 1.0),
        (9.0, 13.0),
        (3.0, 47.0),
        (0.0, 7.3),
        (0.0, 0.3),
        (0.0, 0.0625),
        (300.0, 302.5),
        (300.5, 302.0),
        (0.0, 30.1),
        (0.3, 17.9),
        (100.0, 2000.0),
        (0.0, 525.0),
        (0.0, 2625.0),
        (0.0, 9450.0),
        (200.0, 300.0),
        // The domains and value ranges the rendered QA drew, fit-all and zoomed.
        (0.0, 7.0),
        (1.4, 5.6),
        (100.0, 650.0),
        (210.0, 540.0),
        (0.0125, 0.05),
        (10.0, 27.5),
        (13.5, 24.0),
        (100.0, 1970.0),
        (474.0, 1596.0),
        (0.0, 69.3),
        (0.0, 84.0),
        (0.0, 105.0),
        (0.0, 260.4),
        (0.0, 299.25),
        (0.0, 5250.0),
        (0.0, 8190.0),
        (0.0, 8925.0),
        (0.0, 4_504_500.0),
        (0.0, 5_460_000.0),
        (-2_176_500.0, 1_706_500.0),
        (-2_202_000.0, 2_242_000.0),
        (0.0, 3.3075e-4),
        (0.0, 3.465e-4),
        (0.0, 4.2e-4),
        (0.0, 4.41e-4),
        // Signs.
        (-10.0, 10.0),
        (-45.0, 63.0),
        (-945.0, 0.0),
        (-0.5, 0.5),
        // A tie the coarser step takes, and the smaller step used to.
        (0.0, 1.2),
        (1.0, 7.0),
        // Spans that are exact powers of ten, where two log10s could disagree.
        (0.0, 0.001),
        (0.0, 0.1),
        (0.0, 10.0),
        (0.0, 100.0),
        (0.0, 1000.0),
        (5.0, 1005.0),
        // Exponents: by magnitude, and by a fixed label past twelve characters.
        (0.0, 2.1e6),
        (0.0, 5.25e6),
        (0.0, 9.45e6),
        (-2.1e6, 0.0),
        (0.0, 0.00042),
        (1e-20, 4e-20),
        (1e307, 2e307),
        (1000.0000001, 1000.0000004),
        (1000.00000001, 1000.00000004),
        // A coarse exact set, where a finer step is not exact.
        (3e14, 3e14 + 5.0),
        // No ticks to offer: no width, or no exact integers.
        (5.0, 5.0),
        (250.0, 250.0),
        (0.0, 0.0),
        (1e-20, 1e-20),
        (1e20, 1e20 + 65_536.0),
    ];

    #[derive(serde::Serialize)]
    struct Row {
        low: f64,
        high: f64,
        ticks: Option<Vec<(f64, String)>>,
    }

    /// One row a line, so a moved tick is a one-line difference.
    fn table() -> String {
        let rows: Vec<String> = RANGES
            .iter()
            .map(|&(low, high)| {
                let ticks = nice_ticks(Domain::new(low, high).expect("a table range"), |_| true)
                    .map(|ticks| {
                        ticks
                            .into_iter()
                            .map(|tick| (tick.at, tick.label))
                            .collect()
                    });
                serde_json::to_string(&Row { low, high, ticks }).expect("a row")
            })
            .collect();
        format!("[\n{}\n]\n", rows.join(",\n"))
    }

    #[test]
    fn the_file_is_what_the_rule_gives() {
        let path = concat!(
            env!("CARGO_MANIFEST_DIR"),
            "/../../fixtures/plot-ticks/nice-ticks.json"
        );
        if std::env::var_os("MSCANVAS_WRITE_TICK_TABLE").is_some() {
            std::fs::write(path, table()).expect("the table is written");
        }
        assert_eq!(
            std::fs::read_to_string(path).expect("the table is read"),
            table()
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn domain(low: f64, high: f64) -> Domain {
        Domain::new(low, high).expect("a test domain")
    }

    fn labels(low: f64, high: f64) -> Vec<String> {
        nice_ticks(domain(low, high), |_| true)
            .expect("ticks")
            .into_iter()
            .map(|tick| tick.label)
            .collect()
    }

    #[test]
    fn ordinary_spans_take_four_to_six_round_ticks() {
        assert_eq!(labels(0.0, 94.5), ["0", "20", "40", "60", "80"]);
        assert_eq!(labels(100.5, 500.0), ["200", "300", "400", "500"]);
        assert_eq!(labels(0.0, 1.0), ["0.0", "0.2", "0.4", "0.6", "0.8", "1.0"]);
        assert_eq!(labels(9.0, 13.0), ["9", "10", "11", "12", "13"]);
        for (low, high) in [
            (0.0, 94.5),
            (100.5, 500.0),
            (0.0, 1.0),
            (3.0, 47.0),
            (0.0, 7.3),
        ] {
            let count = labels(low, high).len();
            assert!((4..=6).contains(&count), "{low}..{high}: {count}");
        }
    }

    #[test]
    fn a_decimal_tick_is_the_decimal_number_and_says_so() {
        // `3 × 0.1` is 0.30000000000000004; the tick is the f64 nearest 0.3.
        let ticks = nice_ticks(domain(0.0, 0.3), |_| true).expect("ticks");
        assert!(
            ticks
                .iter()
                .any(|tick| tick.at == 0.3 && tick.label == "0.3")
        );
    }

    #[test]
    fn large_and_tiny_magnitudes_are_written_as_exponents() {
        assert_eq!(labels(0.0, 9.45e6), ["0", "2e6", "4e6", "6e6", "8e6"]);
        assert_eq!(labels(1e-20, 4e-20), ["1e-20", "2e-20", "3e-20", "4e-20"]);
        assert_eq!(
            labels(1e307, 2e307),
            ["1e307", "1.2e307", "1.4e307", "1.6e307", "1.8e307", "2e307"]
        );
    }

    #[test]
    fn a_narrow_window_keeps_its_ticks_apart() {
        let narrow = labels(1000.0000001, 1000.0000004);
        assert!(narrow.len() >= 2);
        let mut sorted = narrow.clone();
        sorted.dedup();
        assert_eq!(sorted, narrow, "no two ticks print alike: {narrow:?}");
        assert!(narrow.iter().all(|label| label.starts_with("1000.000000")));
    }

    #[test]
    fn negative_ticks_carry_their_sign_and_zero_carries_none() {
        assert_eq!(labels(-10.0, 10.0), ["-10", "-5", "0", "5", "10"]);
        assert_eq!(fixed(0, -2), "0.00");
        assert_eq!(fixed(-5, -1), "-0.5");
        assert_eq!(scientific(-15, 5), "-1.5e6");
    }

    #[test]
    fn a_coarse_exact_set_survives_a_finer_step_that_is_not() {
        // Step 0.2 at 3e14 needs integers past the exact range; step 1 does not.
        let ticks = nice_ticks(domain(3e14, 3e14 + 5.0), |_| true).expect("ticks");
        assert_eq!(ticks.len(), 6);
        assert!(ticks.windows(2).all(|pair| pair[0].at < pair[1].at));
    }

    #[test]
    fn a_span_with_no_exact_ticks_has_none() {
        assert!(nice_ticks(domain(5.0, 5.0), |_| true).is_none());
        assert!(nice_ticks(domain(1e20, 1e20 + 65_536.0), |_| true).is_none());
    }

    #[test]
    fn a_cramped_axis_takes_fewer_ticks_rather_than_colliding() {
        let few = nice_ticks(domain(0.0, 100.0), |ticks| ticks.len() <= 3).expect("ticks");
        assert_eq!(few.len(), 3);
        assert!(nice_ticks(domain(0.0, 100.0), |_| false).is_none());
    }
}
