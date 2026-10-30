//! How wide a string is in the face a figure names first.
//!
//! The figure asks for [`FONT_FAMILY`]: Arial, then Liberation Sans, then
//! Helvetica, then the viewer's own sans-serif. The first three share one set
//! of advance widths by design -- Liberation Sans was drawn metric-compatible
//! with Arial, and Arial with Helvetica -- so a layout measured with the table
//! below is the layout every one of them draws, without condensing or
//! stretching a glyph to make it so.
//!
//! The advances were read from the `hmtx` table of Arial 7.060 (`arial.ttf`
//! and `arialbd.ttf`, unitsPerEm 2048) through its Windows Unicode `cmap`, for
//! printable ASCII, Latin-1 and a few typographic characters a label carries.
//! They are numbers about glyphs, not the glyphs: nothing of the font itself is
//! here, and the document still embeds no font.
//!
//! A character outside the table is given one full em. That is wider than any
//! Latin glyph the table holds and exactly the advance of a CJK ideograph, so
//! an unknown character can make a string look shorter than it is drawn only in
//! a face nobody asked for.
//!
//! ponytail: a fixed table, no kerning and no shaping. A viewer that falls
//! through to a wider generic sans-serif draws text a few percent wider than
//! laid out; measuring the resolved face would need the font at render time,
//! which this crate deliberately never opens.

/// The family list every text element is written with.
pub(crate) const FONT_FAMILY: &str = "Arial, 'Liberation Sans', Helvetica, sans-serif";

const UNITS_PER_EM: f64 = 2048.0;

/// U+0020 to U+007E.
const REGULAR_ASCII: [u16; 95] = [
    569, 569, 727, 1139, 1139, 1821, 1366, 391, 682, 682, 797, 1196, 569, 682, 569, 569, 1139,
    1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 569, 569, 1196, 1196, 1196, 1139, 2079,
    1366, 1366, 1479, 1479, 1366, 1251, 1593, 1479, 569, 1024, 1366, 1139, 1706, 1479, 1593, 1366,
    1593, 1479, 1366, 1251, 1479, 1366, 1933, 1366, 1366, 1251, 569, 569, 569, 961, 1139, 682,
    1139, 1139, 1024, 1139, 1139, 569, 1139, 1139, 455, 455, 1024, 455, 1706, 1139, 1139, 1139,
    1139, 682, 1024, 569, 1139, 1024, 1479, 1024, 1024, 1024, 684, 532, 684, 1196,
];

/// U+00A0 to U+00FF.
const REGULAR_LATIN1: [u16; 96] = [
    569, 682, 1139, 1139, 1139, 1139, 532, 1139, 682, 1509, 758, 1139, 1196, 682, 1509, 1131, 819,
    1124, 682, 682, 682, 1180, 1100, 682, 682, 682, 748, 1139, 1708, 1708, 1708, 1251, 1366, 1366,
    1366, 1366, 1366, 1366, 2048, 1479, 1366, 1366, 1366, 1366, 569, 569, 569, 569, 1479, 1479,
    1593, 1593, 1593, 1593, 1593, 1196, 1593, 1479, 1479, 1479, 1479, 1366, 1366, 1251, 1139, 1139,
    1139, 1139, 1139, 1139, 1821, 1024, 1139, 1139, 1139, 1139, 569, 569, 569, 569, 1139, 1139,
    1139, 1139, 1139, 1139, 1139, 1124, 1251, 1139, 1139, 1139, 1139, 1024, 1139, 1024,
];

/// U+0020 to U+007E, bold.
const BOLD_ASCII: [u16; 95] = [
    569, 682, 971, 1139, 1139, 1821, 1479, 487, 682, 682, 797, 1196, 569, 682, 569, 569, 1139,
    1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 1139, 682, 682, 1196, 1196, 1196, 1251, 1997,
    1479, 1479, 1479, 1479, 1366, 1251, 1593, 1479, 569, 1139, 1479, 1251, 1706, 1479, 1593, 1366,
    1593, 1479, 1366, 1251, 1479, 1366, 1933, 1366, 1366, 1251, 682, 569, 682, 1196, 1139, 682,
    1139, 1251, 1139, 1251, 1139, 682, 1251, 1251, 569, 569, 1139, 569, 1821, 1251, 1251, 1251,
    1251, 797, 1139, 682, 1251, 1139, 1593, 1139, 1139, 1024, 797, 573, 797, 1196,
];

/// U+00A0 to U+00FF, bold.
const BOLD_LATIN1: [u16; 96] = [
    569, 682, 1139, 1139, 1139, 1139, 573, 1139, 682, 1509, 758, 1139, 1196, 682, 1509, 1131, 819,
    1124, 682, 682, 682, 1180, 1139, 682, 682, 682, 748, 1139, 1708, 1708, 1708, 1251, 1479, 1479,
    1479, 1479, 1479, 1479, 2048, 1479, 1366, 1366, 1366, 1366, 569, 569, 569, 569, 1479, 1479,
    1593, 1593, 1593, 1593, 1593, 1196, 1593, 1479, 1479, 1479, 1479, 1366, 1366, 1251, 1139, 1139,
    1139, 1139, 1139, 1139, 1821, 1139, 1139, 1139, 1139, 1139, 569, 569, 569, 569, 1251, 1251,
    1251, 1251, 1251, 1251, 1251, 1124, 1251, 1251, 1251, 1251, 1251, 1139, 1251, 1139,
];

/// A few characters beyond Latin-1 that labels carry: regular, then bold.
const EXTRA: [(char, u16, u16); 9] = [
    ('\u{03BC}', 1180, 1253),
    ('\u{2013}', 1139, 1139),
    ('\u{2014}', 2048, 2048),
    ('\u{2018}', 455, 569),
    ('\u{2019}', 455, 569),
    ('\u{201C}', 682, 1024),
    ('\u{201D}', 682, 1024),
    ('\u{2026}', 2048, 2048),
    ('\u{2212}', 1196, 1196),
];

/// One character's advance, in em.
fn advance(character: char, bold: bool) -> f64 {
    let code = u32::from(character);
    let units = match code {
        0x20..=0x7E => Some(if bold { BOLD_ASCII } else { REGULAR_ASCII }[(code - 0x20) as usize]),
        0xA0..=0xFF => {
            Some(if bold { BOLD_LATIN1 } else { REGULAR_LATIN1 }[(code - 0xA0) as usize])
        }
        _ => EXTRA
            .iter()
            .find(|(known, _, _)| *known == character)
            .map(|(_, regular, heavy)| if bold { *heavy } else { *regular }),
    };
    units.map_or(1.0, |units| f64::from(units) / UNITS_PER_EM)
}

/// How wide `text` is drawn at `size`, in the units `size` is in.
pub(crate) fn text_width(text: &str, size: f64, bold: bool) -> f64 {
    text.chars()
        .map(|character| advance(character, bold))
        .sum::<f64>()
        * size
}

/// How wide one regular character is drawn at `size`.
pub(crate) fn char_width(character: char, size: f64) -> f64 {
    advance(character, false) * size
}
