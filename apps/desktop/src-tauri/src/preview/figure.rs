//! What a figure export is asked to look like, and how a raster one is made.
//!
//! Two things live here because they are one decision from the user's side: the
//! settings a figure is rendered with, and the machinery that turns the
//! resulting SVG into pixels.
//!
//! ## PNG is not a second renderer
//!
//! The scientific figure has exactly one author: `FigureSpec`, drawn by the
//! deterministic SVG renderer in `mscanvas-plot-spec`. PNG is that SVG put on a
//! pixel grid. Nothing here reads the spectrum, decides a coordinate, or writes
//! a label -- if it did, there would be two answers to what the figure says, and
//! the one a user saved as PNG could disagree with the one they saved as SVG.
//!
//! ## What the numbers mean
//!
//! Width and height are the **final** dimensions. An SVG is authored at exactly
//! those figure units; a PNG contains exactly that many pixels. DPI is physical
//! resolution *metadata* and multiplies nothing: a user who asks for 1200 x 640
//! receives 1200 x 640 whatever DPI they chose, which is the only reading under
//! which the two formats describe the same figure.

use png::{BitDepth, ColorType, Encoder, PixelDimensions, Unit};
use resvg::tiny_skia::{Pixmap, Transform};
use resvg::usvg::fontdb::{Database, Family, Query};
use resvg::usvg::{Options, Tree};

use mscanvas_plot_spec::spec::{
    FigureSize, FigureTheme, MAX_FIGURE_EDGE, MIN_FIGURE_CHROME_HEIGHT, MIN_FIGURE_WIDTH,
    MIN_PANEL_HEIGHT,
};

/// The figure size M4.1 shipped, and what a user who changes nothing still gets.
pub(super) const DEFAULT_FIGURE_WIDTH: u32 = 1_200;
pub(super) const DEFAULT_FIGURE_HEIGHT: u32 = 640;

/// A conventional print resolution, and the one this application starts at.
///
/// Metadata only. It changes no coordinate and adds no pixel; it tells whatever
/// opens the file how large the image is meant to be on paper.
pub(super) const DEFAULT_PNG_DPI: u32 = 300;

/// The physical resolutions this boundary accepts.
///
/// Wide enough for every conventional choice -- 96 for a screen, 150 for a
/// draft, 300 for print, 600 for high-quality print -- and closed at both ends
/// because a number outside it describes no real output device and would be
/// recorded in the file as a fact about one.
pub(super) const MIN_PNG_DPI: u32 = 72;
pub(super) const MAX_PNG_DPI: u32 = 1_200;

/// How many pixels one rasterization may allocate.
///
/// A vector document can honestly describe a 20,000 x 20,000 figure; a raster
/// one has to hold it. The rasterizer's pixmap is RGBA8 and therefore exactly
/// four bytes a pixel, so this bound is a memory bound stated in the unit the
/// user chose: 32 megapixels is 128 MiB of pixmap, plus the encoder's own
/// buffer.
///
/// It is chosen to sit well above real work and well below the pathological
/// case. The default figure is 0.77 MP. A 7 x 5 inch figure at 600 DPI -- about
/// as large as a journal asks for -- is 4200 x 3000, or 12.6 MP. The vector
/// maximum of 20,000 x 20,000 is 400 MP, which is 1.6 GiB and is refused.
///
/// This is a resource bound, not a promise about what any particular machine
/// can render: it is what this application is willing to try to allocate.
pub(super) const MAX_RASTER_PIXELS: u64 = 32_000_000;

/// What every figure output is drawn with.
///
/// Width, height and theme, and deliberately nothing else. These are the
/// properties *every* figure consumes -- an SVG at this size in this theme, a
/// PNG of these pixels in this theme, a clipboard image of the same -- so they
/// are the ones whose validity every figure output depends on.
///
/// DPI is not here, and that absence is the point. It is written into one
/// format's metadata and read by nothing else, so making it a precondition for
/// constructing *this* would make an unusable DPI refuse an SVG, which is the
/// defect this type exists to make unrepresentable.
///
/// Session state and nothing more. Nothing here is written to disk, and a
/// restart begins at the defaults again.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct FigureRenderSettings {
    width: u32,
    height: u32,
    theme: FigureTheme,
}

impl Default for FigureRenderSettings {
    fn default() -> Self {
        Self {
            width: DEFAULT_FIGURE_WIDTH,
            height: DEFAULT_FIGURE_HEIGHT,
            theme: FigureTheme::Light,
        }
    }
}

/// Why one figure could not be drawn as asked.
///
/// Separated from a single "invalid" because the interface says something
/// different about each, and a reader told only that something is wrong has to
/// guess which number to change.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum SettingsRefusal {
    /// Outside what a figure of this shape can be.
    SizeOutOfRange,
    /// Not a theme this application has.
    UnknownTheme,
    /// Not a physical resolution this boundary records. **PNG only.**
    DpiOutOfRange,
    /// Describable as a vector, too large to hold as pixels. **Raster only.**
    RasterBudget,
}

impl FigureRenderSettings {
    /// Reads the properties every figure output consumes.
    ///
    /// The wire carries integers because these are counts of pixels, and a
    /// fractional pixel is not a thing a user can have asked for.
    pub(super) fn from_wire(width: u32, height: u32, theme: &str) -> Result<Self, SettingsRefusal> {
        let theme = match theme {
            "light" => FigureTheme::Light,
            "dark" => FigureTheme::Dark,
            _ => return Err(SettingsRefusal::UnknownTheme),
        };
        // The vector contract, and only that. A size it refuses is not a size
        // any format here can render.
        //
        // The raster budget is deliberately *not* asked here. It is a question
        // about the output rather than about the figure: a vector document can
        // honestly describe a 20,000 x 20,000 figure and this application will
        // write one, so refusing those settings outright would refuse an SVG
        // that renders perfectly well.
        Self::size_of(width, height).ok_or(SettingsRefusal::SizeOutOfRange)?;
        Ok(Self {
            width,
            height,
            theme,
        })
    }

    /// The vector size these dimensions describe, if the contract allows it.
    fn size_of(width: u32, height: u32) -> Option<FigureSize> {
        let (width, height) = (f64::from(width), f64::from(height));
        // Asked here as well as inside `FigureSize::new`, because the floors
        // below are what make the refusal specific rather than a bare "no".
        if !(MIN_FIGURE_WIDTH..=MAX_FIGURE_EDGE).contains(&width)
            || !(MIN_FIGURE_CHROME_HEIGHT + MIN_PANEL_HEIGHT..=MAX_FIGURE_EDGE).contains(&height)
        {
            return None;
        }
        FigureSize::new(width, height).ok()
    }

    /// The size the figure is authored at.
    pub(super) fn size(self) -> FigureSize {
        Self::size_of(self.width, self.height)
            .expect("a constructed settings object holds an accepted size")
    }

    pub(super) const fn theme(self) -> FigureTheme {
        self.theme
    }

    pub(super) const fn width(self) -> u32 {
        self.width
    }

    pub(super) const fn height(self) -> u32 {
        self.height
    }
}

/// One physical resolution, for the one format that records one.
///
/// A separate type because it is a separate question. Constructing it is what
/// PNG does and no other output does, so an unusable value refuses a PNG and
/// leaves every other export alone.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) struct PngDpi(u32);

impl Default for PngDpi {
    fn default() -> Self {
        Self(DEFAULT_PNG_DPI)
    }
}

impl PngDpi {
    /// Reads one physical resolution, refusing anything outside the range this
    /// boundary records.
    pub(super) fn from_wire(dpi: u32) -> Result<Self, SettingsRefusal> {
        if !(MIN_PNG_DPI..=MAX_PNG_DPI).contains(&dpi) {
            return Err(SettingsRefusal::DpiOutOfRange);
        }
        Ok(Self(dpi))
    }

    pub(super) const fn get(self) -> u32 {
        self.0
    }
}

/// Refuses a figure too large to hold as pixels, before any are allocated.
///
/// Every raster-producing operation asks this, and asks it in one place so the
/// two cannot drift: PNG had the check and `Copy plot` did not, and the copy
/// path would have attempted a 1.6 GiB pixmap for a figure the vector contract
/// quite correctly allows.
///
/// A refusal is an answer; an exhausted machine is not.
pub(super) fn validate_raster_budget(
    settings: FigureRenderSettings,
) -> Result<(), SettingsRefusal> {
    let pixels = u64::from(settings.width()) * u64::from(settings.height());
    if pixels > MAX_RASTER_PIXELS {
        return Err(SettingsRefusal::RasterBudget);
    }
    Ok(())
}

/// Why a figure could not be turned into pixels.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum RasterFailure {
    /// No font this machine has can draw the figure's text.
    NoUsableFont,
    /// The SVG could not be parsed as a document to draw.
    Unrenderable,
    /// The pixel buffer could not be allocated.
    OutOfMemory,
    /// The encoder refused the image.
    NotEncodable,
}

/// One rasterized figure, in straight (non-premultiplied) RGBA8.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) struct FigureRaster {
    width: u32,
    height: u32,
    rgba: Vec<u8>,
}

impl FigureRaster {
    pub(super) const fn width(&self) -> u32 {
        self.width
    }

    pub(super) const fn height(&self) -> u32 {
        self.height
    }

    /// Straight RGBA8, four bytes a pixel, row-major.
    pub(super) fn rgba(&self) -> &[u8] {
        &self.rgba
    }

    pub(super) fn into_rgba(self) -> Vec<u8> {
        self.rgba
    }
}

/// Whether this machine can draw the figure's text at all.
///
/// The figure asks for `sans-serif`, and a rasterizer that cannot resolve it
/// does not fail -- it draws everything except the words, which is the one
/// outcome a scientific figure must never quietly have. So the question is asked
/// before rendering and answered with a refusal, leaving SVG, which needs no
/// font because it keeps the text as text.
fn fonts() -> Option<Database> {
    let mut database = Database::new();
    database.load_system_fonts();
    let query = Query {
        families: &[Family::SansSerif],
        ..Query::default()
    };
    database.query(&query).map(|_| database)
}

/// Draws one SVG document at exactly these dimensions.
pub(super) fn rasterize(svg: &str, width: u32, height: u32) -> Result<FigureRaster, RasterFailure> {
    rasterize_using(svg, width, height, fonts())
}

/// The same drawing, told which fonts it has.
///
/// Split out so a test can pass `None` and exercise the machine this
/// application must fail closed on: one where no typeface can draw a label. That
/// is the one raster failure that would otherwise be invisible, because a
/// figure with its words missing still looks like a figure.
fn rasterize_using(
    svg: &str,
    width: u32,
    height: u32,
    database: Option<Database>,
) -> Result<FigureRaster, RasterFailure> {
    let database = database.ok_or(RasterFailure::NoUsableFont)?;
    let mut options = Options {
        // The figure is authored at its final size, so it is drawn at 1:1. No
        // scale is applied anywhere: a pixel of the raster is a unit of the
        // vector, which is what makes "the same figure" a checkable claim.
        default_size: resvg::usvg::Size::from_wh(width as f32, height as f32)
            .ok_or(RasterFailure::Unrenderable)?,
        ..Options::default()
    };
    options.fontdb = std::sync::Arc::new(database);

    let tree = Tree::from_str(svg, &options).map_err(|_| RasterFailure::Unrenderable)?;
    let mut pixmap = Pixmap::new(width, height).ok_or(RasterFailure::OutOfMemory)?;
    resvg::render(&tree, Transform::default(), &mut pixmap.as_mut());

    // Demultiplied, because a PNG stores straight alpha and the pixmap stores
    // premultiplied. The figure's background is opaque so this is the identity
    // in practice, and doing it anyway is what keeps that an observation rather
    // than an assumption.
    let mut rgba = Vec::with_capacity((width as usize) * (height as usize) * 4);
    for pixel in pixmap.pixels() {
        let colour = pixel.demultiply();
        rgba.extend_from_slice(&[colour.red(), colour.green(), colour.blue(), colour.alpha()]);
    }

    Ok(FigureRaster {
        width,
        height,
        rgba,
    })
}

/// A rasterization on a machine with no usable font.
#[cfg(test)]
pub(super) fn rasterize_without_fonts(
    svg: &str,
    width: u32,
    height: u32,
) -> Result<FigureRaster, RasterFailure> {
    rasterize_using(svg, width, height, None)
}

/// How many pixels per metre one physical resolution is.
///
/// PNG records physical resolution per metre; users think in inches. One inch
/// is 25.4 mm exactly, so this conversion is exact up to the rounding a whole
/// number of pixels per metre forces -- and that rounding is small enough that
/// reading it back gives the requested figure again, which the tests assert
/// rather than assume.
pub(super) fn pixels_per_metre(dpi: u32) -> u32 {
    const METRES_PER_INCH: f64 = 0.025_4;
    (f64::from(dpi) / METRES_PER_INCH).round() as u32
}

/// The physical resolution a stored pixels-per-metre describes.
///
/// The inverse of the conversion above, and used to check it: a resolution that
/// does not survive the round trip is one the file would misreport.
#[cfg(test)]
pub(super) fn dpi_of(pixels_per_metre: u32) -> u32 {
    const METRES_PER_INCH: f64 = 0.025_4;
    (f64::from(pixels_per_metre) * METRES_PER_INCH).round() as u32
}

/// Encodes one raster as a PNG carrying the requested physical resolution.
pub(super) fn encode_png(raster: &FigureRaster, dpi: u32) -> Result<Vec<u8>, RasterFailure> {
    let mut bytes = Vec::new();
    {
        let mut encoder = Encoder::new(&mut bytes, raster.width, raster.height);
        encoder.set_color(ColorType::Rgba);
        encoder.set_depth(BitDepth::Eight);
        // The `pHYs` chunk, which is what makes the chosen DPI a property of the
        // file rather than a number the interface once displayed.
        let per_metre = pixels_per_metre(dpi);
        encoder.set_pixel_dims(Some(PixelDimensions {
            xppu: per_metre,
            yppu: per_metre,
            unit: Unit::Meter,
        }));
        let mut writer = encoder
            .write_header()
            .map_err(|_| RasterFailure::NotEncodable)?;
        writer
            .write_image_data(raster.rgba())
            .map_err(|_| RasterFailure::NotEncodable)?;
    }
    Ok(bytes)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// A document of the shape this application produces: an opaque background
    /// and text in the generic family the figure renderer asks for.
    fn document(width: u32, height: u32, background: &str, ink: &str) -> String {
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" width=\"{width}\" height=\"{height}\" \
             viewBox=\"0 0 {width} {height}\">\
             <rect x=\"0\" y=\"0\" width=\"{width}\" height=\"{height}\" fill=\"{background}\"/>\
             <text x=\"12\" y=\"40\" fill=\"{ink}\" font-family=\"sans-serif\" \
             font-size=\"18\">Intensity</text></svg>"
        )
    }

    fn pixel(raster: &FigureRaster, x: u32, y: u32) -> [u8; 4] {
        let start = ((y * raster.width() + x) * 4) as usize;
        let bytes = &raster.rgba()[start..start + 4];
        [bytes[0], bytes[1], bytes[2], bytes[3]]
    }

    #[test]
    fn a_figure_rasterizes_at_exactly_the_requested_dimensions() {
        let raster = rasterize(&document(200, 100, "#ffffff", "#000000"), 200, 100)
            .expect("the figure rasterizes");

        assert_eq!(raster.width(), 200);
        assert_eq!(raster.height(), 100);
        assert_eq!(raster.rgba().len(), 200 * 100 * 4);
    }

    #[test]
    fn the_figure_background_is_opaque_everywhere() {
        // No alpha holes. A figure saved with transparent regions looks like a
        // figure with missing data when it is placed on a coloured page.
        let raster = rasterize(&document(120, 60, "#ffffff", "#000000"), 120, 60)
            .expect("the figure rasterizes");

        assert!(
            raster.rgba().chunks_exact(4).all(|pixel| pixel[3] == 255),
            "every pixel is fully opaque"
        );
    }

    #[test]
    fn text_is_drawn_rather_than_silently_omitted() {
        // The one failure a scientific figure must never have quietly. If the
        // rasterizer could not resolve a font it would render everything except
        // the words, and the image would look finished.
        let raster = rasterize(&document(200, 100, "#ffffff", "#000000"), 200, 100)
            .expect("the figure rasterizes");

        let inked = raster
            .rgba()
            .chunks_exact(4)
            .filter(|pixel| pixel[0] < 200 && pixel[1] < 200 && pixel[2] < 200)
            .count();
        assert!(
            inked > 40,
            "the label drew glyphs rather than nothing: {inked} dark pixels"
        );
    }

    #[test]
    fn a_dark_figure_differs_from_a_light_one() {
        let light =
            rasterize(&document(120, 60, "#ffffff", "#000000"), 120, 60).expect("light renders");
        let dark =
            rasterize(&document(120, 60, "#12161c", "#ffffff"), 120, 60).expect("dark renders");

        assert_ne!(pixel(&light, 2, 2), pixel(&dark, 2, 2));
        assert_ne!(light.rgba(), dark.rgba());
    }

    #[test]
    fn the_same_figure_rasterizes_the_same_way_twice() {
        // Within one environment. Across machines the installed font
        // implementation decides the glyphs, which is why this is asserted here
        // and not claimed anywhere else.
        let svg = document(160, 80, "#ffffff", "#000000");
        let first = rasterize(&svg, 160, 80).expect("renders");
        let second = rasterize(&svg, 160, 80).expect("renders again");

        assert_eq!(first.rgba(), second.rgba());
    }

    #[test]
    fn a_png_carries_the_requested_physical_resolution() {
        let raster = rasterize(&document(120, 60, "#ffffff", "#000000"), 120, 60).expect("renders");

        for dpi in [MIN_PNG_DPI, 96, 150, DEFAULT_PNG_DPI, 600, MAX_PNG_DPI] {
            let bytes = encode_png(&raster, dpi).expect("encodes");
            let decoder = png::Decoder::new(std::io::Cursor::new(&bytes));
            let reader = decoder.read_info().expect("the PNG parses");
            let info = reader.info();

            assert_eq!(info.width, 120);
            assert_eq!(info.height, 60);
            assert_eq!(info.color_type, png::ColorType::Rgba);
            assert_eq!(info.bit_depth, png::BitDepth::Eight);

            let dimensions = info
                .pixel_dims
                .expect("the physical resolution is recorded");
            assert_eq!(dimensions.unit, png::Unit::Meter);
            assert_eq!(dimensions.xppu, dimensions.yppu);
            assert_eq!(
                dpi_of(dimensions.xppu),
                dpi,
                "{dpi} DPI survives the round trip through pixels per metre"
            );
        }
    }

    #[test]
    fn a_png_begins_with_the_png_signature() {
        let raster = rasterize(&document(64, 32, "#ffffff", "#000000"), 64, 32).expect("renders");
        let bytes = encode_png(&raster, DEFAULT_PNG_DPI).expect("encodes");

        assert_eq!(&bytes[..8], b"\x89PNG\r\n\x1a\n");
    }

    #[test]
    fn the_default_settings_are_the_figure_m4_1_shipped() {
        let settings = FigureRenderSettings::default();

        assert_eq!(settings.width(), 1_200);
        assert_eq!(settings.height(), 640);
        assert_eq!(settings.theme(), FigureTheme::Light);
        assert!((settings.size().width() - 1_200.0).abs() < f64::EPSILON);
        assert!((settings.size().height() - 640.0).abs() < f64::EPSILON);
        assert_eq!(PngDpi::default().get(), 300);
    }

    #[test]
    fn settings_refuse_what_no_figure_could_be() {
        use SettingsRefusal::{SizeOutOfRange, UnknownTheme};

        assert_eq!(
            FigureRenderSettings::from_wire(0, 640, "light"),
            Err(SizeOutOfRange)
        );
        assert_eq!(
            FigureRenderSettings::from_wire(1_200, 0, "light"),
            Err(SizeOutOfRange)
        );
        assert_eq!(
            FigureRenderSettings::from_wire(199, 640, "light"),
            Err(SizeOutOfRange)
        );
        assert_eq!(
            FigureRenderSettings::from_wire(1_200, 179, "light"),
            Err(SizeOutOfRange)
        );
        assert_eq!(
            FigureRenderSettings::from_wire(20_001, 640, "light"),
            Err(SizeOutOfRange)
        );
        assert_eq!(
            FigureRenderSettings::from_wire(1_200, 640, "sepia"),
            Err(UnknownTheme)
        );
        // Describable as a vector, and therefore accepted here: the raster
        // budget is a question about the *output*, asked by the formats that
        // have to hold every pixel, not by the figure itself.
        FigureRenderSettings::from_wire(20_000, 20_000, "light")
            .expect("the largest vector figure is a figure");
    }

    #[test]
    fn a_resolution_no_png_could_record_is_refused_and_reaches_nothing_else() {
        // The resolution is its own type because it is its own question. An
        // unusable one refuses the format that writes it, and there is no way
        // to make it refuse anything else: nothing but a PNG constructs one.
        assert_eq!(
            PngDpi::from_wire(MIN_PNG_DPI - 1),
            Err(SettingsRefusal::DpiOutOfRange)
        );
        assert_eq!(
            PngDpi::from_wire(MAX_PNG_DPI + 1),
            Err(SettingsRefusal::DpiOutOfRange)
        );
        assert_eq!(PngDpi::from_wire(0), Err(SettingsRefusal::DpiOutOfRange));
        assert_eq!(PngDpi::from_wire(50), Err(SettingsRefusal::DpiOutOfRange));
        // And the figure those same settings describe is untouched by it: an
        // SVG or a clipboard copy asked for beside an unusable resolution is
        // still a figure this application draws.
        FigureRenderSettings::from_wire(1_200, 640, "light")
            .expect("a figure is a figure whatever a resolution says");
    }

    #[test]
    fn settings_accept_the_conventional_resolutions_and_the_boundary_sizes() {
        for dpi in [MIN_PNG_DPI, 96, 150, 300, 600, MAX_PNG_DPI] {
            let accepted = PngDpi::from_wire(dpi)
                .unwrap_or_else(|_| panic!("{dpi} DPI is a resolution this boundary records"));
            assert_eq!(accepted.get(), dpi, "and it records the one that was asked");
        }
        for theme in ["light", "dark"] {
            FigureRenderSettings::from_wire(1_200, 640, theme).expect("both themes exist");
        }
        // The smallest figure the contract allows.
        FigureRenderSettings::from_wire(200, 180, "light").expect("the minimum is a figure");
        // The largest that still fits the raster budget: 32 megapixels exactly.
        FigureRenderSettings::from_wire(8_000, 4_000, "light").expect("32 MP is inside");
    }

    #[test]
    fn the_raster_budget_is_asked_of_the_output_rather_than_the_figure() {
        // A vector document can honestly describe a figure a raster one cannot
        // hold. Refusing those settings outright would refuse an SVG that is
        // perfectly renderable -- and the refusal that used to be produced said
        // the figure could still be exported as SVG at any size, which retrying
        // SVG would then have contradicted.
        let vector_only =
            FigureRenderSettings::from_wire(20_000, 20_000, "light").expect("a figure");
        assert_eq!(
            validate_raster_budget(vector_only),
            Err(SettingsRefusal::RasterBudget)
        );

        let exactly_at_the_budget =
            FigureRenderSettings::from_wire(8_000, 4_000, "light").expect("a figure");
        assert_eq!(validate_raster_budget(exactly_at_the_budget), Ok(()));

        let one_row_past =
            FigureRenderSettings::from_wire(8_000, 4_001, "light").expect("a figure");
        assert_eq!(
            validate_raster_budget(one_row_past),
            Err(SettingsRefusal::RasterBudget)
        );
    }

    #[test]
    fn pixels_per_metre_round_trips_every_accepted_resolution() {
        for dpi in MIN_PNG_DPI..=MAX_PNG_DPI {
            assert_eq!(
                dpi_of(pixels_per_metre(dpi)),
                dpi,
                "{dpi} DPI survives conversion to whole pixels per metre"
            );
        }
    }
}
