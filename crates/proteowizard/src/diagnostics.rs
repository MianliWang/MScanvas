//! Turning what a run knows into what a run may say.
//!
//! Two things live here, and they answer the same question from opposite ends.
//! The [`Redactor`] knows *particular* paths — the acquisition, the folder, the
//! staging area, the executable — and removes every spelling of them it can
//! obtain. [`absolute_path_start`] knows none of them and recognises the
//! *shape* of an absolute path anywhere it appears.
//!
//! Neither is sufficient alone. Backend text records paths nobody handed this
//! process, so the token list will always be incomplete; and a shape test that
//! decided what to keep would be deciding it about text no one has read. So the
//! two compose: exact tokens are replaced, and what remains is judged by shape.
//! [`BackendTextExcerpt`] is that composition made fail-closed — an excerpt that
//! still looks like it names somewhere on this computer is withheld rather than
//! reported, because a suppressed excerpt costs a diagnosis and a leaked one
//! costs the user something they cannot take back.

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::{ProcessOutput, Termination};

/// The most encoded UTF-8 bytes one redacted stream excerpt may carry.
///
/// Applied after decoding and redaction, to the text as it will be written,
/// rather than to the captured bytes: what a bound on a diagnostics file has to
/// promise is about the file, and redaction changes the length of everything it
/// touches. It is far below the process boundary's own 8 MiB capture limit, and
/// deliberately so — that limit exists so a run holds a whole conversation in
/// memory, and this one exists so a person can read the result.
pub const MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES: usize = 32 * 1024;

#[derive(Clone, Copy, PartialEq, Eq)]
enum ReplacementKind {
    Literal,
    Path,
}

#[derive(Clone, PartialEq, Eq)]
struct Replacement {
    value: String,
    replacement: String,
    kind: ReplacementKind,
}

#[derive(Clone, Default, PartialEq, Eq)]
pub struct Redactor {
    replacements: Vec<Replacement>,
}

impl Redactor {
    #[must_use]
    pub fn new() -> Self {
        let mut redactor = Self::default();
        for variable in ["USERPROFILE", "HOME"] {
            if let Some(value) = std::env::var_os(variable) {
                redactor.add_path(Path::new(&value), "<user-profile>");
            }
        }

        if let (Some(drive), Some(home_path)) =
            (std::env::var_os("HOMEDRIVE"), std::env::var_os("HOMEPATH"))
        {
            let profile = format!("{}{}", drive.to_string_lossy(), home_path.to_string_lossy());
            redactor.add_path(Path::new(&profile), "<user-profile>");
        }

        redactor
    }

    #[must_use]
    pub fn with_path(mut self, path: &Path, replacement: impl Into<String>) -> Self {
        self.add_path(path, replacement);
        self
    }

    /// Registers safe-to-obtain spellings of an absolute filesystem path.
    ///
    /// This covers lexical dot normalization, separator and case differences,
    /// canonical filesystem paths, Win32 extended-length prefixes, and Win32
    /// short/long names when the operating system exposes them. It deliberately
    /// does not claim equivalence for every NT object-manager namespace, device
    /// path, alternate data stream, or filesystem-specific alias.
    pub fn add_path(&mut self, path: &Path, replacement: impl Into<String>) {
        let replacement = replacement.into();
        for value in collect_path_aliases(path) {
            self.add_replacement(value, replacement.clone(), ReplacementKind::Path);
        }
    }

    pub fn add_literal(&mut self, value: &str, replacement: &str) {
        if value.is_empty() {
            return;
        }
        self.add_replacement(
            value.to_owned(),
            replacement.to_owned(),
            ReplacementKind::Literal,
        );
    }

    fn add_replacement(&mut self, value: String, replacement: String, kind: ReplacementKind) {
        if value.is_empty() {
            return;
        }

        self.replacements.push(Replacement {
            value,
            replacement,
            kind,
        });
        self.replacements
            .sort_by_key(|entry| std::cmp::Reverse(entry.value.len()));
        self.replacements.dedup();
    }

    #[must_use]
    pub fn redact(&self, text: &str) -> String {
        self.redact_counted(text).0
    }

    /// Redacts, and says how many replacements it made.
    ///
    /// The count is reported to the user in a diagnostics export, where it is
    /// the only honest thing that can be said about how much was removed: the
    /// values themselves must not be listed, and an export that said nothing
    /// would leave a reader unable to tell thorough redaction from none at all.
    ///
    /// It counts replacements, not distinct paths. One path written three times
    /// counts three, which is what "how much of this text was rewritten" means.
    #[must_use]
    pub fn redact_counted(&self, text: &str) -> (String, usize) {
        self.replacements
            .iter()
            .fold(
                (text.to_owned(), 0),
                |(redacted, count), entry| match entry.kind {
                    ReplacementKind::Literal => {
                        let (redacted, made) =
                            replace_case_insensitive(&redacted, &entry.value, &entry.replacement);
                        (redacted, count + made)
                    }
                    ReplacementKind::Path => {
                        let (redacted, made) =
                            replace_path_alias(&redacted, &entry.value, &entry.replacement);
                        (redacted, count + made)
                    }
                },
            )
    }

    /// Every placeholder this redactor can emit, deduplicated and ordered.
    ///
    /// Needed by the shape test that runs afterwards. A path whose root was
    /// replaced leaves its remainder behind — `<destination>\run.mzML` — and
    /// that remainder begins with a separator, which is exactly what an absolute
    /// UNC or POSIX root looks like. Knowing the placeholders is what lets the
    /// shape test tell "this is the tail of something already removed" from
    /// "this is somewhere nobody has removed".
    fn placeholders(&self) -> Vec<&str> {
        let mut placeholders: Vec<&str> = self
            .replacements
            .iter()
            .map(|entry| entry.replacement.as_str())
            .collect();
        placeholders.sort_unstable();
        placeholders.dedup();
        placeholders
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReportableProcessOutput {
    pub exit_code: Option<i32>,
    pub elapsed_millis: u128,
    pub termination: Termination,
    pub max_active_processes: Option<u32>,
    pub final_active_processes: Option<u32>,
    pub stdout_total_bytes: u64,
    pub stderr_total_bytes: u64,
    pub stdout_truncated: bool,
    pub stderr_truncated: bool,
    pub stdout: String,
    pub stderr: String,
}

impl ReportableProcessOutput {
    #[must_use]
    pub fn from_process(output: &ProcessOutput, redactor: &Redactor) -> Self {
        Self {
            exit_code: output.exit_code,
            elapsed_millis: output.elapsed.as_millis(),
            termination: output.termination,
            max_active_processes: output.max_active_processes,
            final_active_processes: output.final_active_processes,
            stdout_total_bytes: output.stdout_total_bytes,
            stderr_total_bytes: output.stderr_total_bytes,
            stdout_truncated: output.stdout_truncated,
            stderr_truncated: output.stderr_truncated,
            stdout: redactor.redact(&String::from_utf8_lossy(&output.stdout)),
            stderr: redactor.redact(&String::from_utf8_lossy(&output.stderr)),
        }
    }
}

/// Finds the first byte offset at which an absolute path begins, or `None`.
///
/// A shape test, not a lookup: it knows no path and asks only whether one
/// starts here. Markers are recognized anywhere in the line rather than only at
/// a token start, because backend and mzML text routinely write them as
/// `key=<path>` or inside quotes.
///
/// Takes one line. Where a path *ends* cannot be decided — `D:\Program
/// Files\run.raw` contains a space — so every caller acts on the whole
/// remainder of the line rather than on a span this could measure.
///
/// Deliberately conservative in one direction. Answering "yes" about ordinary
/// prose costs a caller some text; answering "no" about a real path costs the
/// user a location they did not choose to reveal.
#[must_use]
pub fn absolute_path_start(line: &str) -> Option<usize> {
    let bytes = line.as_bytes();
    for (index, _) in line.char_indices() {
        let preceding = if index == 0 {
            None
        } else {
            bytes.get(index - 1)
        };
        let after_boundary = preceding.is_none_or(|byte| !byte.is_ascii_alphanumeric());

        // Compared as bytes, never sliced as text: `index + 5` is not
        // necessarily a character boundary, and backend text may legitimately
        // hold non-ASCII. Slicing there would panic on valid input.
        if after_boundary
            && bytes
                .get(index..index + 5)
                .is_some_and(|prefix| prefix.eq_ignore_ascii_case(b"file:"))
        {
            return Some(index);
        }

        // A UNC root, an extended-length or device prefix — both of which begin
        // `\\` — or a POSIX-absolute root, which carries a single leading
        // slash: text written on Linux or macOS records `/home/...` and is just
        // as revealing when read on Windows. The preceding-boundary test keeps
        // `m/z`, `counts/second` and a bare `a / b` readable, and the next
        // character must be able to start a path segment.
        if matches!(bytes.get(index), Some(b'\\' | b'/'))
            && preceding.is_none_or(|byte| {
                // Backend text brackets and separates values in several ways,
                // including `key:value`, so a colon counts as a boundary too.
                // Only the `://` of a URI authority is exempt, below.
                byte.is_ascii_whitespace() || is_strong_boundary(*byte)
            })
            && !starts_uri_authority(bytes, index)
            // What may follow depends on what came before. After a strong
            // boundary the value starts here whatever its first character is,
            // so a directory whose name begins with a space is still a path.
            // After whitespace, another space means this is prose — the
            // `a / b` this test exists to leave alone — and not a root.
            //
            // A whitelist of filename characters would be the wrong shape
            // either way: `$HOME`, `@archive` and non-ASCII names are all
            // ordinary segments, and a list of what is allowed will always be
            // missing something.
            && bytes.get(index + 1).is_some_and(|byte| {
                !byte.is_ascii_whitespace()
                    || preceding.is_some_and(|preceding| is_strong_boundary(*preceding))
            })
        {
            return Some(index);
        }

        if after_boundary
            && bytes.get(index).is_some_and(u8::is_ascii_alphabetic)
            && bytes.get(index + 1) == Some(&b':')
            && matches!(bytes.get(index + 2), Some(b'\\' | b'/'))
        {
            return Some(index);
        }
    }
    None
}

/// Punctuation that separates a key from its value in backend text.
///
/// Distinct from whitespace: after one of these the value begins immediately,
/// whatever its first character is.
const fn is_strong_boundary(byte: u8) -> bool {
    matches!(
        byte,
        b'=' | b'"' | b'\'' | b'(' | b'[' | b'{' | b'<' | b',' | b';' | b'|' | b':'
    )
}

/// Whether the slash at `index` opens the `//` of a URI authority.
///
/// Only that exact shape is exempt, rather than every slash after a colon: a
/// field written as `source:/home/alice/run.raw` is a path, while
/// `http://psi.hupo.org/ms/mzml` is a vocabulary reference worth keeping.
fn starts_uri_authority(bytes: &[u8], index: usize) -> bool {
    if bytes.get(index) != Some(&b'/') || bytes.get(index + 1) != Some(&b'/') || index == 0 {
        return false;
    }
    if bytes.get(index - 1) != Some(&b':') {
        return false;
    }
    let mut scheme_start = index - 1;
    while scheme_start > 0
        && bytes
            .get(scheme_start - 1)
            .is_some_and(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'+' | b'-' | b'.'))
    {
        scheme_start -= 1;
    }
    // A scheme is at least one character and starts with a letter.
    scheme_start < index - 1 && bytes.get(scheme_start).is_some_and(u8::is_ascii_alphabetic)
}

/// Why an excerpt was withheld instead of exported.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ExcerptSuppression {
    /// Every known spelling was replaced and the text still looks like it names
    /// an absolute local path.
    ResidualAbsolutePath,
}

impl ExcerptSuppression {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::ResidualAbsolutePath => "residual_absolute_path",
        }
    }
}

/// One backend stream, decoded, sanitized, redacted, bounded — or withheld.
///
/// Built where a run still knows its own paths, and it is the only form of
/// backend text that outlives the run. The raw bytes are dropped when the run
/// that captured them returns, so nothing downstream can retain, forward or
/// re-redact them: there is no accessor for them here because there is nothing
/// left to accessorise.
///
/// Every count beside the text describes the *original* stream rather than what
/// survived. A reader has to be able to tell "the backend said little" from
/// "the backend said a great deal and this is the first part of it", and from
/// "the backend said something this refused to repeat".
#[derive(Clone, PartialEq, Eq)]
pub struct BackendTextExcerpt {
    /// `None` when the shape test refused it. Absent rather than emptied, so a
    /// suppressed excerpt cannot be mistaken for a silent stream.
    text: Option<String>,
    suppression: Option<ExcerptSuppression>,
    lossy: bool,
    total_bytes: u64,
    captured_bytes: u64,
    capture_truncated: bool,
    excerpt_truncated: bool,
    redactions: usize,
}

impl BackendTextExcerpt {
    /// Builds one excerpt from one captured stream.
    ///
    /// The order is the argument. Control characters are removed first, because
    /// a stream is bytes and nothing downstream should have to defend against
    /// what a backend can put in them. Exact spellings are replaced next, while
    /// the text is still whole — truncating first would cut a path in half and
    /// leave a fragment no token matches. The bound is applied after redaction,
    /// because redaction changes lengths and the promise is about the exported
    /// text. And the shape test runs last, on exactly the string that would be
    /// written, so nothing is judged that is not what a reader would see.
    #[must_use]
    pub fn of_stream(
        captured: &[u8],
        total_bytes: u64,
        capture_truncated: bool,
        redactor: &Redactor,
    ) -> Self {
        let decoded = String::from_utf8_lossy(captured);
        let lossy = matches!(decoded, std::borrow::Cow::Owned(_));
        let sanitized = sanitize_control_characters(&decoded);
        let (redacted, redactions) = redactor.redact_counted(&sanitized);
        let (bounded, excerpt_truncated) =
            truncate_to_bytes(redacted, MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES);
        let suppression = residual_absolute_path(&bounded, &redactor.placeholders())
            .then_some(ExcerptSuppression::ResidualAbsolutePath);
        Self {
            text: suppression.is_none().then_some(bounded),
            suppression,
            lossy,
            total_bytes,
            captured_bytes: captured.len() as u64,
            capture_truncated,
            excerpt_truncated,
            redactions,
        }
    }

    /// The exported text, or `None` when it was withheld.
    #[must_use]
    pub fn text(&self) -> Option<&str> {
        self.text.as_deref()
    }

    #[must_use]
    pub const fn suppression(&self) -> Option<ExcerptSuppression> {
        self.suppression
    }

    /// Whether decoding replaced bytes that are not valid UTF-8.
    #[must_use]
    pub const fn lossy(&self) -> bool {
        self.lossy
    }

    /// How many bytes the stream produced in total, whether captured or not.
    #[must_use]
    pub const fn total_bytes(&self) -> u64 {
        self.total_bytes
    }

    /// How many bytes the process boundary held.
    #[must_use]
    pub const fn captured_bytes(&self) -> u64 {
        self.captured_bytes
    }

    /// Whether the process boundary's own capture limit cut the stream.
    #[must_use]
    pub const fn capture_truncated(&self) -> bool {
        self.capture_truncated
    }

    /// Whether this excerpt's own bound cut what capture had kept.
    ///
    /// Distinct from `capture_truncated`, and reported separately: they are two
    /// different limits and a reader deciding whether to raise the capture
    /// limit or the excerpt bound needs to know which one was reached.
    #[must_use]
    pub const fn excerpt_truncated(&self) -> bool {
        self.excerpt_truncated
    }

    #[must_use]
    pub const fn redactions(&self) -> usize {
        self.redactions
    }
}

/// Deliberately opaque. Whatever survived redaction is still backend text, and
/// a `{:?}` of a value holding it would put it into a panic message or a log.
impl std::fmt::Debug for BackendTextExcerpt {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("BackendTextExcerpt")
            .field("text", &"<opaque-backend-excerpt>")
            .field("suppressed", &self.suppression.is_some())
            .finish_non_exhaustive()
    }
}

/// Replaces every control character a reader has no use for.
///
/// `\n`, `\r` and `\t` are the structure of a console stream and are kept.
/// Everything else in the C0 range, and DEL, becomes the replacement character:
/// a NUL would truncate the text for anything that reads it as a C string, and
/// an escape sequence would let backend text move a terminal cursor or repaint
/// a line in whatever eventually displays this.
fn sanitize_control_characters(text: &str) -> String {
    text.chars()
        .map(|character| match character {
            '\n' | '\r' | '\t' => character,
            _ if character.is_control() => char::REPLACEMENT_CHARACTER,
            _ => character,
        })
        .collect()
}

/// Keeps the leading `limit` bytes, cut at a character boundary.
///
/// A prefix, because a prefix is what the process boundary captured: it holds
/// the first bytes of a stream and drops the rest, so there is no suffix here
/// to keep and claiming one would describe output nobody has.
fn truncate_to_bytes(text: String, limit: usize) -> (String, bool) {
    if text.len() <= limit {
        return (text, false);
    }
    let end = floor_char_boundary(&text, limit);
    let mut text = text;
    text.truncate(end);
    (text, true)
}

/// Whether anything in this text still looks like an absolute local path.
///
/// Runs on the redacted text, so the only hits it should see are shapes no
/// registered token matched. One of them is not a leak: replacing the root of
/// `D:\outputs\run.mzML` leaves `<destination>\run.mzML`, whose separator is
/// indistinguishable by shape from a UNC or POSIX root. A separator directly
/// after a placeholder is therefore read as the remainder of something already
/// removed and scanning continues past it.
///
/// Only a separator is forgiven that way. A drive letter or a `file:` URL after
/// a placeholder is not the tail of anything — `<source>D:\private\run.raw`
/// names a location nothing has replaced — so those still answer yes.
///
/// And a remainder is one name, never a tree. What may follow a placeholder is
/// a single component, which is the class the schema already exports as a
/// display fact; two or more is directory structure that survived because a
/// *less* specific token matched the root, and it is refused.
///
/// That case is real rather than theoretical. Where a path is spelled with some
/// components short and others long — which Windows does, and which a machine
/// whose profile has an 8.3 name does routinely — the acquisition's own
/// registration can miss while the temporary root's still matches, leaving the
/// folders between them in the text. Nothing here can obtain that hybrid
/// spelling in advance, so the shape rule is what catches it.
fn residual_absolute_path(text: &str, placeholders: &[&str]) -> bool {
    text.split_inclusive('\n')
        .any(|line| line_names_a_location(line, placeholders))
}

fn line_names_a_location(line: &str, placeholders: &[&str]) -> bool {
    let mut from = 0;
    while let Some(relative) = absolute_path_start(&line[from..]) {
        let start = from + relative;
        let separator = line[start..].starts_with(is_separator);
        if separator && ends_with_placeholder(&line[..start], placeholders) {
            // One byte, because a separator is ASCII and the scan has to
            // resume inside the remainder rather than skip over it.
            from = start + 1;
            continue;
        }
        return true;
    }
    remainder_carries_directories(line, placeholders) || carries_a_separator_run(line, placeholders)
}

/// Whether what is left of a line, once redacted remainders are set aside,
/// still carries the separators of a directory tree.
///
/// The rules above all begin at a boundary, because a boundary is what tells a
/// root from `m/z`. Backend text does not always give them one: a label
/// concatenated with a path -- `source/home/alice/private.raw`, or
/// `source\\\\server\\share\\private.raw` -- puts every separator after an
/// alphanumeric, where no boundary rule can see it. The drive-letter form
/// escapes the same way and is caught by the colon after it; POSIX and UNC
/// forms have no colon to be caught by.
///
/// So this asks the two things that survive concatenation. Two separators of
/// any kind in one line is a tree. And one separator is enough when what
/// follows it carries a dot, because that is a file name and `source/run.raw`
/// at the root of a volume needs no second separator to be a location.
///
/// The dot is what keeps the tokens this must not take with it. `m/z` and
/// `counts/second` are one separator between bare words, which is a unit and
/// not a path; a ratio written `1.0/2.0` is suppressed, which is the direction
/// this errs in everywhere else.
///
/// It is also where this stops, and the limit is stated rather than papered
/// over. One separator between two bare words with no dot -- `source/private`
/// concatenated straight onto a label -- is the same shape as `m/z`, character
/// for character in the only features available here. Catching it means
/// suppressing every excerpt containing `m/z`, which is nearly every line
/// `msconvert` prints. So a single extensionless segment at the root of a
/// volume, printed with no space or punctuation before it, is a residual this
/// test does not remove; ADR 0017 records it, and the warning shipped with
/// every export is what covers it.
///
/// It is deliberately not the shared shape test's business. That one decides
/// what a *screen* hides, where losing a line of an acquisition's own metadata
/// would be a poor trade. This decides what a *file the user may send onward*
/// keeps, where the same strictness is the right call.
///
/// A remainder the redactor left behind does not count: it is one name, it is
/// governed above, and counting it would suppress every excerpt naming an
/// output.
fn carries_a_separator_run(line: &str, placeholders: &[&str]) -> bool {
    let mut remaining = line.to_owned();
    for placeholder in placeholders {
        if placeholder.is_empty() {
            continue;
        }
        remaining = remaining.replace(&format!("{placeholder}\\"), "");
        remaining = remaining.replace(&format!("{placeholder}/"), "");
    }
    let separators = remaining
        .chars()
        .filter(|character| is_separator(*character))
        .count();
    separators >= 2 || names_a_file_after_a_separator(&remaining)
}

/// Whether any separator is followed by something shaped like a file name.
///
/// The segment ends at the next separator or at whitespace, because a name is
/// what sits between those. A dot inside it is the whole test: it is what
/// separates `run.raw` from `z` and from `second`.
fn names_a_file_after_a_separator(line: &str) -> bool {
    let mut rest = line;
    while let Some(offset) = rest.find(is_separator) {
        let after = &rest[offset + 1..];
        let segment_end = after
            .find(|character: char| is_separator(character) || character.is_whitespace())
            .unwrap_or(after.len());
        if after[..segment_end].contains('.') {
            return true;
        }
        rest = after;
    }
    false
}

/// Whether anything following a placeholder is more than one path component.
///
/// Measured between one placeholder and the next rather than to the end of the
/// line, so a line naming two redacted paths — each with its own single
/// remainder — is not read as one remainder with several components.
fn remainder_carries_directories(line: &str, placeholders: &[&str]) -> bool {
    let mut cursor = 0;
    while let Some((start, end)) = next_placeholder(line, cursor, placeholders) {
        let following =
            next_placeholder(line, end, placeholders).map_or(line.len(), |(next, _)| next);
        let remainder = &line[end..following];
        if remainder.starts_with(is_separator)
            && remainder
                .chars()
                .filter(|character| is_separator(*character))
                .count()
                > 1
        {
            return true;
        }
        // Past this placeholder, never past the segment: the next one is where
        // the scan resumes, and it was found from `end` above.
        cursor = end.max(start + 1);
    }
    false
}

/// The first placeholder at or after `from`, as the half-open range it spans.
fn next_placeholder(line: &str, from: usize, placeholders: &[&str]) -> Option<(usize, usize)> {
    placeholders
        .iter()
        .filter(|placeholder| !placeholder.is_empty())
        .filter_map(|placeholder| {
            line.get(from..)
                .and_then(|rest| rest.find(*placeholder))
                .map(|offset| (from + offset, from + offset + placeholder.len()))
        })
        // The earliest one, and the longest where two begin together, so a
        // placeholder that is a prefix of another cannot end the scan early.
        .min_by_key(|(start, end)| (*start, std::cmp::Reverse(*end)))
}

fn ends_with_placeholder(prefix: &str, placeholders: &[&str]) -> bool {
    placeholders
        .iter()
        .any(|placeholder| !placeholder.is_empty() && prefix.ends_with(placeholder))
}

fn collect_path_aliases(path: &Path) -> Vec<String> {
    if !is_absolute_path(path) {
        return Vec::new();
    }

    let mut filesystem_paths = vec![path.to_path_buf()];
    if let Ok(canonical) = std::fs::canonicalize(path) {
        push_unique_path(&mut filesystem_paths, canonical);
    }

    #[cfg(windows)]
    {
        let initial_paths = filesystem_paths.clone();
        for candidate in initial_paths {
            if let Some(short) = win32_short_path(&candidate) {
                push_unique_path(&mut filesystem_paths, short);
            }
            if let Some(long) = win32_long_path(&candidate) {
                push_unique_path(&mut filesystem_paths, long);
            }
        }

        // A short spelling obtained above can expose a distinct long spelling
        // even when the originally configured path used another filesystem alias.
        let expanded_paths = filesystem_paths.clone();
        for candidate in expanded_paths {
            if let Some(long) = win32_long_path(&candidate) {
                push_unique_path(&mut filesystem_paths, long);
            }
        }
    }

    let mut aliases = BTreeSet::new();
    for candidate in filesystem_paths {
        let candidate = candidate.to_string_lossy();
        if let Some(normalized) = normalize_path_lexically(&candidate) {
            for alias in extended_length_variants(&normalized) {
                aliases.insert(alias);
            }
        }
    }

    aliases.into_iter().collect()
}

fn push_unique_path(paths: &mut Vec<PathBuf>, candidate: PathBuf) {
    if !paths.iter().any(|existing| existing == &candidate) {
        paths.push(candidate);
    }
}

fn is_absolute_path(path: &Path) -> bool {
    if path.is_absolute() {
        return true;
    }

    let text = path.to_string_lossy();
    let bytes = text.as_bytes();
    text.starts_with("\\\\")
        || text.starts_with("//")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && is_separator_byte(bytes[2]))
}

fn normalize_path_lexically(value: &str) -> Option<String> {
    if value.is_empty() || value.contains('\0') {
        return None;
    }

    let value = value.replace('/', "\\");
    let (prefix, rest, protected_components, rooted) = split_path_prefix(&value)?;
    let mut components: Vec<&str> = Vec::new();

    for component in rest.split('\\') {
        match component {
            "" | "." => {}
            ".." if components.len() > protected_components => {
                components.pop();
            }
            ".." if rooted => {}
            ".." => components.push(component),
            _ => components.push(component),
        }
    }

    let mut normalized = prefix;
    if !components.is_empty() {
        if !normalized.is_empty() && !normalized.ends_with('\\') {
            normalized.push('\\');
        }
        normalized.push_str(&components.join("\\"));
    }

    (!normalized.is_empty()).then_some(normalized)
}

fn split_path_prefix(value: &str) -> Option<(String, &str, usize, bool)> {
    if starts_ascii_case_insensitive(value, "\\\\?\\UNC\\") {
        return Some(("\\\\?\\UNC\\".to_owned(), &value[8..], 2, true));
    }

    if starts_ascii_case_insensitive(value, "\\\\?\\") {
        let rest = &value[4..];
        let bytes = rest.as_bytes();
        if bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'\\'
        {
            return Some((
                format!("\\\\?\\{}:\\", bytes[0] as char),
                &rest[3..],
                0,
                true,
            ));
        }

        // Other extended NT/device namespace forms are intentionally outside
        // this bounded filesystem-path redaction contract.
        return None;
    }

    if let Some(rest) = value.strip_prefix("\\\\") {
        return Some(("\\\\".to_owned(), rest, 2, true));
    }

    let bytes = value.as_bytes();
    if bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\' {
        return Some((format!("{}:\\", bytes[0] as char), &value[3..], 0, true));
    }

    if let Some(rest) = value.strip_prefix('\\') {
        return Some(("\\".to_owned(), rest, 0, true));
    }

    Some((String::new(), value, 0, false))
}

fn extended_length_variants(path: &str) -> Vec<String> {
    let mut variants = vec![path.to_owned()];
    if starts_ascii_case_insensitive(path, "\\\\?\\UNC\\") {
        variants.push(format!("\\\\{}", &path[8..]));
    } else if starts_ascii_case_insensitive(path, "\\\\?\\") {
        variants.push(path[4..].to_owned());
    } else if let Some(rest) = path.strip_prefix("\\\\") {
        variants.push(format!("\\\\?\\UNC\\{rest}"));
    } else if is_drive_absolute(path) {
        variants.push(format!("\\\\?\\{path}"));
    }
    variants
}

fn is_drive_absolute(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() >= 3 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' && bytes[2] == b'\\'
}

fn replace_path_alias(input: &str, alias: &str, replacement: &str) -> (String, usize) {
    let mut result = String::with_capacity(input.len());
    let mut cursor = 0;
    let mut replaced = 0;

    while let Some((start, end)) = find_path_alias(input, alias, cursor) {
        result.push_str(&input[cursor..start]);
        result.push_str(replacement);
        cursor = end;
        replaced += 1;
    }

    result.push_str(&input[cursor..]);
    (result, replaced)
}

fn find_path_alias(input: &str, alias: &str, from: usize) -> Option<(usize, usize)> {
    input[from..].char_indices().find_map(|(relative, _)| {
        let start = from + relative;
        if !is_left_path_boundary(input, start) {
            return None;
        }

        if let Some(end) = match_path_characters(input, start, alias)
            && is_right_path_boundary(input, end, alias)
        {
            return Some((start, end));
        }

        find_dot_normalized_match(input, start, alias).map(|end| (start, end))
    })
}

fn match_path_characters(input: &str, start: usize, alias: &str) -> Option<usize> {
    let mut input_chars = input[start..].char_indices();
    let mut consumed = 0;

    for expected in alias.chars() {
        let (relative, actual) = input_chars.next()?;
        if !path_chars_equal(actual, expected) {
            return None;
        }
        consumed = relative + actual.len_utf8();
    }

    Some(start + consumed)
}

fn find_dot_normalized_match(input: &str, start: usize, alias: &str) -> Option<usize> {
    let last_component = alias.trim_end_matches('\\').rsplit('\\').next()?;
    if last_component.is_empty() || !root_prefix_matches(&input[start..], alias) {
        return None;
    }

    const MAX_PATH_SCAN_BYTES: usize = 131_072;
    let scan_end = input.len().min(start.saturating_add(MAX_PATH_SCAN_BYTES));
    let scan_end = floor_char_boundary(input, scan_end);
    let candidate_region = &input[start..scan_end];

    for (relative, _) in candidate_region.char_indices() {
        let component_start = start + relative;
        if component_start > start
            && !input[..component_start]
                .chars()
                .next_back()
                .is_some_and(is_separator)
        {
            continue;
        }

        let Some(end) = match_path_characters(input, component_start, last_component) else {
            continue;
        };
        if !is_right_path_boundary(input, end, alias) {
            continue;
        }

        let candidate = &input[start..end];
        if !contains_dot_component(candidate) {
            continue;
        }
        if normalize_path_lexically(candidate)
            .as_deref()
            .is_some_and(|normalized| paths_equal(normalized, alias))
        {
            return Some(end);
        }
    }

    None
}

fn root_prefix_matches(candidate: &str, alias: &str) -> bool {
    let Some((alias_prefix, _, _, _)) = split_path_prefix(alias) else {
        return false;
    };
    if alias_prefix.is_empty() {
        return false;
    }

    match_path_characters(candidate, 0, &alias_prefix).is_some()
}

fn contains_dot_component(value: &str) -> bool {
    value
        .split(is_separator)
        .any(|component| matches!(component, "." | ".."))
}

fn floor_char_boundary(value: &str, mut index: usize) -> usize {
    while !value.is_char_boundary(index) {
        index -= 1;
    }
    index
}

fn is_left_path_boundary(input: &str, start: usize) -> bool {
    start == 0
        || input[..start]
            .chars()
            .next_back()
            .is_some_and(is_path_delimiter)
}

fn is_right_path_boundary(input: &str, end: usize, alias: &str) -> bool {
    if end == input.len() || alias.ends_with('\\') {
        return true;
    }

    let suffix = &input[end..];
    suffix
        .chars()
        .next()
        .is_some_and(|character| is_separator(character) || is_path_delimiter(character))
        || is_sentence_ending_period_boundary(suffix)
}

fn is_sentence_ending_period_boundary(suffix: &str) -> bool {
    let remainder = suffix.trim_start_matches('.');
    remainder.len() < suffix.len()
        && (remainder.is_empty() || remainder.chars().next().is_some_and(is_path_delimiter))
}

fn is_path_delimiter(character: char) -> bool {
    character.is_whitespace()
        || matches!(
            character,
            '"' | '\''
                | '('
                | ')'
                | '['
                | ']'
                | '{'
                | '}'
                | '<'
                | '>'
                | '='
                | ':'
                | ';'
                | ','
                | '!'
                | '?'
                | '|'
                | '#'
        )
}

fn path_chars_equal(left: char, right: char) -> bool {
    (is_separator(left) && is_separator(right)) || left.to_lowercase().eq(right.to_lowercase())
}

fn paths_equal(left: &str, right: &str) -> bool {
    match_path_characters(left, 0, right).is_some_and(|end| end == left.len())
}

fn is_separator(character: char) -> bool {
    matches!(character, '\\' | '/')
}

fn is_separator_byte(byte: u8) -> bool {
    matches!(byte, b'\\' | b'/')
}

fn replace_case_insensitive(input: &str, needle: &str, replacement: &str) -> (String, usize) {
    if needle.is_empty() {
        return (input.to_owned(), 0);
    }

    let mut result = String::with_capacity(input.len());
    let mut cursor = 0;
    let mut replaced = 0;
    while let Some(start) = find_ascii_case_insensitive(input, needle, cursor) {
        let end = start + needle.len();
        result.push_str(&input[cursor..start]);
        result.push_str(replacement);
        cursor = end;
        replaced += 1;
    }
    result.push_str(&input[cursor..]);
    (result, replaced)
}

fn find_ascii_case_insensitive(input: &str, needle: &str, from: usize) -> Option<usize> {
    let needle_bytes = needle.as_bytes();
    input[from..].char_indices().find_map(|(relative, _)| {
        let start = from + relative;
        let end = start.checked_add(needle_bytes.len())?;
        if end > input.len() || !input.is_char_boundary(end) {
            return None;
        }
        input.as_bytes()[start..end]
            .iter()
            .zip(needle_bytes)
            .all(|(left, right)| left.eq_ignore_ascii_case(right))
            .then_some(start)
    })
}

fn starts_ascii_case_insensitive(value: &str, prefix: &str) -> bool {
    value
        .get(..prefix.len())
        .is_some_and(|candidate| candidate.eq_ignore_ascii_case(prefix))
}

#[cfg(windows)]
fn win32_short_path(path: &Path) -> Option<PathBuf> {
    win32_path_alias(path, get_short_path_name_w)
}

#[cfg(windows)]
fn win32_long_path(path: &Path) -> Option<PathBuf> {
    win32_path_alias(path, get_long_path_name_w)
}

#[cfg(windows)]
type Win32PathNameFunction = unsafe extern "system" fn(*const u16, *mut u16, u32) -> u32;

#[cfg(windows)]
fn win32_path_alias(path: &Path, function: Win32PathNameFunction) -> Option<PathBuf> {
    use std::ffi::OsString;
    use std::os::windows::ffi::{OsStrExt, OsStringExt};

    let input: Vec<u16> = path
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();
    if input[..input.len().saturating_sub(1)].contains(&0) {
        return None;
    }

    let mut output = vec![0_u16; input.len().max(260)];
    loop {
        // SAFETY: `input` is NUL-terminated, `output` owns a writable buffer of
        // the stated size, and the Win32 function does not retain either pointer.
        let length = unsafe {
            function(
                input.as_ptr(),
                output.as_mut_ptr(),
                u32::try_from(output.len()).ok()?,
            )
        };
        if length == 0 {
            return None;
        }

        let length = length as usize;
        if length < output.len() {
            output.truncate(length);
            return Some(PathBuf::from(OsString::from_wide(&output)));
        }

        output.resize(length.saturating_add(1), 0);
    }
}

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "GetShortPathNameW"]
    fn get_short_path_name_w(
        long_path: *const u16,
        short_path: *mut u16,
        buffer_length: u32,
    ) -> u32;
    #[link_name = "GetLongPathNameW"]
    fn get_long_path_name_w(short_path: *const u16, long_path: *mut u16, buffer_length: u32)
    -> u32;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_paths_are_redacted_case_insensitively_with_mixed_separators() {
        let redactor = Redactor::default().with_path(
            Path::new(r"C:\Users\Local User\Mass Spec\sample 01.raw"),
            "<input>",
        );

        let text = concat!(
            r"Failed C:\USERS/LOCAL USER\Mass Spec/sample 01.raw; ",
            "retry C:/Users/Local User/Mass Spec/sample 01.raw"
        );
        let redacted = redactor.redact(text);

        assert_eq!(redacted, "Failed <input>; retry <input>");
        assert!(!redacted.contains("Local User"));
        assert!(!redacted.contains("sample 01"));
    }

    #[test]
    fn sentence_ending_periods_after_paths_are_preserved_and_redacted() {
        let redactor =
            Redactor::default().with_path(Path::new(r"C:\Lab.v2\样本.v1.raw"), "<input>");

        for (text, expected) in [
            (r"failed C:\Lab.v2\样本.v1.raw.", "failed <input>."),
            (
                "failed c:/lab.v2/样本.v1.raw. Retry",
                "failed <input>. Retry",
            ),
            (r#"failed C:\Lab.v2\样本.v1.raw.)"#, "failed <input>.)"),
            (
                "failed C:\\Lab.v2\\样本.v1.raw.\r\nRetry",
                "failed <input>.\r\nRetry",
            ),
            (r"failed C:\Lab.v2\样本.v1.raw...", "failed <input>..."),
        ] {
            assert_eq!(redactor.redact(text), expected);
        }

        assert_eq!(
            redactor.redact(r"failed \\?\c:\lab.v2\样本.v1.raw."),
            "failed <input>."
        );
    }

    #[test]
    fn periods_inside_longer_path_like_tokens_are_not_boundaries() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Data\sample.raw"), "<input>");

        for suffix in [".bak", ".part", ".1", ".中文", r".\child", "./child"] {
            let text = format!(r"C:\Data\sample.raw{suffix}");
            assert_eq!(redactor.redact(&text), text);
        }
    }

    #[test]
    fn reportable_diagnostics_redact_an_unquoted_path_before_a_period() {
        let stderr = br"failed to read C:\private\sample.raw.";
        let output = ProcessOutput {
            stdout: Vec::new(),
            stderr: stderr.to_vec(),
            stdout_total_bytes: 0,
            stderr_total_bytes: stderr.len() as u64,
            stdout_truncated: false,
            stderr_truncated: false,
            exit_code: Some(1),
            elapsed: std::time::Duration::ZERO,
            termination: Termination::Exited,
            max_active_processes: None,
            final_active_processes: None,
            peak_job_memory_bytes: None,
        };
        let redactor =
            Redactor::default().with_path(Path::new(r"C:\private\sample.raw"), "<input>");

        let reportable = ReportableProcessOutput::from_process(&output, &redactor);

        assert_eq!(reportable.stderr, "failed to read <input>.");
    }

    #[test]
    fn dot_segments_are_normalized_without_touching_the_filesystem() {
        let redactor =
            Redactor::default().with_path(Path::new(r"C:\Evidence\Runs\sample.raw"), "<input>");

        assert_eq!(
            redactor.redact(r"c:\EVIDENCE\scratch\..\RUNS\.\SAMPLE.raw"),
            "<input>"
        );
    }

    #[test]
    fn drive_and_unc_extended_length_spellings_are_redacted() {
        let drive = Redactor::default().with_path(Path::new(r"C:\Evidence\sample.raw"), "<input>");
        assert_eq!(drive.redact(r"\\?\c:\evidence\sample.raw"), "<input>");

        let unc = Redactor::default()
            .with_path(Path::new(r"\\server\share\Evidence\sample.raw"), "<input>");
        assert_eq!(
            unc.redact(r"\\?\UNC\SERVER\SHARE\Evidence\sample.raw"),
            "<input>"
        );
    }

    #[test]
    fn directory_aliases_redact_descendants_at_component_boundaries() {
        let redactor =
            Redactor::default().with_path(Path::new(r"C:\Evidence\output"), "<output-root>");

        assert_eq!(
            redactor.redact(r"wrote C:\Evidence\output\converted.mzML"),
            r"wrote <output-root>\converted.mzML"
        );
    }

    #[test]
    fn near_miss_paths_and_scientific_numbers_are_not_over_redacted() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Data\run1"), "<input>");
        let text = concat!(
            "mz=101.007276 rt=1.0 intensity=1.25e+07; ",
            r"XC:\Data\run1 C:\Data\run10 C:\Data\run1.raw C:\Data\run1"
        );

        assert_eq!(
            redactor.redact(text),
            concat!(
                "mz=101.007276 rt=1.0 intensity=1.25e+07; ",
                r"XC:\Data\run1 C:\Data\run10 C:\Data\run1.raw <input>"
            )
        );
    }

    #[test]
    fn non_absolute_values_are_not_registered_as_paths() {
        let redactor = Redactor::default().with_path(Path::new("1.25"), "<input>");

        assert_eq!(redactor.redact("intensity 1.25"), "intensity 1.25");
    }

    #[test]
    fn unicode_path_case_is_compared_without_changing_non_ascii_bytes() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Data\样本 01.raw"), "<input>");

        assert_eq!(redactor.redact(r"c:\data\样本 01.raw"), "<input>");
    }

    /// One captured stream, as the process boundary hands it over.
    fn excerpt(captured: &[u8], redactor: &Redactor) -> BackendTextExcerpt {
        BackendTextExcerpt::of_stream(captured, captured.len() as u64, false, redactor)
    }

    /// The count is what an export reports in place of the values it removed,
    /// so it counts replacements rather than distinct paths: one path written
    /// three times was rewritten three times.
    #[test]
    fn redaction_counts_every_replacement_it_makes() {
        let redactor = Redactor::default()
            .with_path(Path::new(r"C:\Data\run.raw"), "<source>")
            .with_path(Path::new(r"D:\Outputs"), "<destination>");

        let (redacted, count) = redactor.redact_counted(
            r"read C:\Data\run.raw, read c:/data/run.raw again, wrote D:\Outputs\run.mzML",
        );

        assert_eq!(
            redacted,
            r"read <source>, read <source> again, wrote <destination>\run.mzML"
        );
        assert_eq!(count, 3);
        assert_eq!(redactor.redact_counted("nothing here").1, 0);
    }

    /// Every absolute shape this crate claims to recognise, and the ordinary
    /// text it must leave alone. This is the test that decides what gets
    /// withheld, so it enumerates rather than samples.
    #[test]
    fn the_shape_test_recognises_every_absolute_form_and_no_prose() {
        for named in [
            r"D:\private\run.raw",
            r"wrote D:\private\run.raw",
            r"\\server\share\run.raw",
            r"\\?\C:\private\run.raw",
            r"\\?\UNC\server\share\run.raw",
            r"\\.\C:\private\run.raw",
            "file:///D:/private/run.raw",
            "FILE:///D:/private/run.raw",
            "/home/alice/run.raw",
            r#"source="D:\private\run.raw""#,
            "source='/home/alice/run.raw'",
            "source=D:/private/run.raw",
        ] {
            assert!(absolute_path_start(named).is_some(), "{named}");
        }

        for prose in [
            "mz=101.007276 rt=1.0 intensity=1.25e+07",
            "scanWindow: 200-2000 m/z at counts/second",
            "cv: http://psi.hupo.org/ms/mzml",
            "ratio: 3 / 4",
            "ratio: 3:1",
            "exit code 1",
            "sample: 標準サンプル",
        ] {
            assert!(absolute_path_start(prose).is_none(), "{prose}");
        }
    }

    /// A remainder is one name, never a tree.
    ///
    /// The case that matters is not hypothetical: where a path is spelled with
    /// some components short and others long, the acquisition's own token can
    /// miss while a less specific one — the temporary root — still matches,
    /// which leaves the folders between them sitting in the text after a
    /// placeholder. No token this boundary can obtain in advance covers that
    /// hybrid, so the shape rule is the only thing that catches it.
    #[test]
    fn a_remainder_of_more_than_one_component_is_not_forgiven() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Temp"), "<local-path>");

        // One component after the placeholder: a name, and one the schema
        // already exports as a display fact.
        let kept = excerpt(br"read C:\Temp\run.raw", &redactor);
        assert_eq!(kept.text(), Some(r"read <local-path>\run.raw"));

        // Two: the folder between them is directory structure that survived
        // because a less specific token matched the root.
        let withheld = excerpt(br"read C:\Temp\private-study\run.raw", &redactor);
        assert_eq!(withheld.text(), None);
        assert_eq!(
            withheld.suppression(),
            Some(ExcerptSuppression::ResidualAbsolutePath)
        );

        // Two redacted paths on one line, each with its own single remainder,
        // is two remainders rather than one with three components -- and the
        // separator count sets a remainder aside for the same reason.
        let both = excerpt(br"read C:\Temp\a.raw then wrote C:\Temp\b.mzML", &redactor);
        assert_eq!(
            both.text(),
            Some(r"read <local-path>\a.raw then wrote <local-path>\b.mzML")
        );
    }

    /// A placeholder in the backend's own output buys no exemption.
    ///
    /// Nothing here can tell a marker redaction emitted from one an
    /// acquisition's metadata happened to contain, so the exemption must not
    /// rest on trusting it. It does not: what follows still has to be one
    /// component, and a path has more.
    #[test]
    fn a_placeholder_the_backend_printed_does_not_excuse_a_path_after_it() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Temp"), "<local-path>");

        for printed in [
            "spectrum title <local-path>/home/alice/private.raw",
            r"spectrum title <local-path>\Users\alice\private.raw",
        ] {
            let excerpt = excerpt(printed.as_bytes(), &redactor);
            assert_eq!(excerpt.text(), None, "{printed}");
            assert_eq!(
                excerpt.suppression(),
                Some(ExcerptSuppression::ResidualAbsolutePath),
                "{printed}"
            );
        }
    }

    /// A path pressed straight up against a label is still a path.
    ///
    /// Backend text concatenates without a space more often than it should,
    /// and the exact redactor cannot match `sourceC:\\Users\\...` because its own
    /// left-boundary rule refuses a token that begins mid-word. What catches it
    /// is the separator after the colon rather than the drive letter: a colon is
    /// a value boundary in this text, so the root is recognised from its right
    /// side when it cannot be recognised from its left.
    #[test]
    fn a_drive_root_pressed_against_a_label_is_still_recognised() {
        for concatenated in [
            r"sourceC:\Users\alice\private.raw",
            "sourceC:/Users/alice/private.raw",
            r"input=fileD:\private\run.raw",
        ] {
            assert!(
                absolute_path_start(concatenated).is_some(),
                "{concatenated}"
            );
        }

        // And end to end: nothing registered matches it, so the excerpt goes.
        let redactor = Redactor::default().with_path(Path::new(r"C:\Temp"), "<local-path>");
        let withheld = excerpt(br"sourceC:\Users\alice\private.raw", &redactor);
        assert_eq!(withheld.text(), None);
        assert_eq!(
            withheld.suppression(),
            Some(ExcerptSuppression::ResidualAbsolutePath)
        );
    }

    /// A POSIX or UNC path pressed against a label has no colon to save it.
    ///
    /// The drive-letter form escapes the boundary rules and is caught by the
    /// separator after its colon. These two escape the same way and have no
    /// colon, so what catches them is the count: two separators in one line is
    /// a tree, whatever came before the first one.
    #[test]
    fn a_posix_or_unc_path_pressed_against_a_label_is_withheld() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Temp"), "<local-path>");

        for concatenated in [
            "source/home/alice/private.raw",
            "source/home/alice",
            // One separator, at the root of a volume, and still a location:
            // what follows it is a file name.
            "source/private.raw",
            r"source\\private.raw",
            r"source\\server\share\private.raw",
        ] {
            let withheld = excerpt(concatenated.as_bytes(), &redactor);
            assert_eq!(withheld.text(), None, "{concatenated}");
            assert_eq!(
                withheld.suppression(),
                Some(ExcerptSuppression::ResidualAbsolutePath),
                "{concatenated}"
            );
        }

        // And the ordinary backend text this must not take with it.
        for prose in [
            "mz=101.007276 rt=1.0 intensity=1.25e+07",
            "scanWindow: 200-2000 m/z",
            "reading spectra at counts/second",
        ] {
            let kept = excerpt(prose.as_bytes(), &redactor);
            assert_eq!(kept.text(), Some(prose), "{prose}");
        }
    }

    /// The trade the shape test makes, pinned so it cannot be made silently.
    ///
    /// `m/z` is not optional vocabulary -- it is in nearly every line the
    /// backend prints -- and one separator between two bare words is the same
    /// shape whether the words are a unit or a folder and a name. Anything
    /// strict enough to withhold the second withholds the first, which is the
    /// whole excerpt for the whole queue.
    ///
    /// This test exists so that changing either side of that trade shows up as
    /// a decision rather than as a passing suite.
    #[test]
    fn the_shape_test_keeps_the_vocabulary_it_cannot_tell_a_root_from() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Temp"), "<local-path>");

        // Kept, and they have to be.
        for vocabulary in ["m/z", "counts/second", "scanWindow: 200-2000 m/z"] {
            assert_eq!(
                excerpt(vocabulary.as_bytes(), &redactor).text(),
                Some(vocabulary),
                "{vocabulary}"
            );
        }

        // And the cost on the other side, which is real and is not a leak: two
        // unit tokens on one line are two separators, and two separators is
        // the rule that catches `source/home/alice`. The excerpt goes; the
        // counts, the outcome and every structured fact stay.
        assert_eq!(
            excerpt(b"200-2000 m/z at counts/second", &redactor).text(),
            None
        );

        // The residual that costs. One extensionless segment at the root of a
        // volume, with nothing before the separator to mark it -- indexed here
        // as a known limit rather than asserted as a good outcome.
        assert_eq!(
            excerpt(b"source/private", &redactor).text(),
            Some("source/private")
        );

        // Everything one step further along is caught: a second segment, an
        // extension, or any boundary at all before the separator.
        for caught in [
            "source/private/run",
            "source/private.raw",
            "source /private",
            "source=/private",
        ] {
            assert_eq!(
                excerpt(caught.as_bytes(), &redactor).text(),
                None,
                "{caught}"
            );
        }
    }

    /// The one false positive that would make the whole feature useless.
    ///
    /// Replacing a directory root leaves its remainder behind, and a remainder
    /// begins with a separator — which by shape alone is a UNC or POSIX root. A
    /// separator directly after a placeholder is the tail of something already
    /// removed; anything else after one is not.
    #[test]
    fn a_remainder_after_a_placeholder_is_not_a_new_absolute_path() {
        let redactor = Redactor::default().with_path(Path::new(r"D:\Outputs"), "<destination>");

        let kept = excerpt(br"wrote D:\Outputs\run.mzML then finished", &redactor);
        assert_eq!(
            kept.text(),
            Some(r"wrote <destination>\run.mzML then finished")
        );
        assert_eq!(kept.suppression(), None);

        // A drive letter after a placeholder is not a tail. It names somewhere
        // nothing replaced, so the excerpt is withheld.
        let withheld = excerpt(
            br"wrote D:\Outputs then read E:\Elsewhere\run.raw",
            &redactor,
        );
        assert_eq!(withheld.text(), None);
        assert_eq!(
            withheld.suppression(),
            Some(ExcerptSuppression::ResidualAbsolutePath)
        );
    }

    /// Fail-closed: a path nothing registered survives redaction, so the whole
    /// excerpt is withheld rather than exported with it in.
    #[test]
    fn an_unregistered_absolute_path_withholds_the_whole_excerpt() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Data\run.raw"), "<source>");

        let suppressed = excerpt(
            b"line one is harmless\nread C:\\Data\\run.raw\nspilled D:\\Private\\other.raw\n",
            &redactor,
        );

        assert_eq!(suppressed.text(), None);
        assert_eq!(
            suppressed.suppression(),
            Some(ExcerptSuppression::ResidualAbsolutePath)
        );
        // Every count still describes the stream, because withholding the text
        // must not also withhold the fact that there was some.
        assert!(suppressed.total_bytes() > 0);
        assert_eq!(suppressed.redactions(), 1);
    }

    /// Bytes are bytes. Invalid UTF-8 is reported rather than hidden, and the
    /// control characters a console stream carries are removed rather than
    /// passed to whatever eventually displays them.
    #[test]
    fn invalid_utf8_is_reported_and_control_characters_are_removed() {
        let redactor = Redactor::default();
        let captured = b"ok \xff\xfe bad\x00nul\x1b[31mescape\x07bell\ttab\r\nline";

        let excerpt = excerpt(captured, &redactor);
        let text = excerpt.text().expect("nothing here looks like a path");

        assert!(excerpt.lossy());
        assert!(!text.contains('\u{0}'));
        assert!(!text.contains('\u{1b}'));
        assert!(!text.contains('\u{7}'));
        // The three that are the structure of a stream survive.
        assert!(text.contains('\t'));
        assert!(text.contains("\r\n"));
        assert_eq!(excerpt.captured_bytes(), captured.len() as u64);
    }

    /// Two limits, two answers. A reader deciding whether the capture limit or
    /// the excerpt bound was reached cannot be told with one flag.
    #[test]
    fn capture_truncation_and_excerpt_truncation_are_reported_apart() {
        let redactor = Redactor::default();
        let long = vec![b'x'; MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES + 4_096];

        // The process boundary kept everything it saw; this bound is what cut
        // the excerpt.
        let ours = BackendTextExcerpt::of_stream(&long, long.len() as u64, false, &redactor);
        assert!(ours.excerpt_truncated());
        assert!(!ours.capture_truncated());
        assert_eq!(
            ours.text().map(str::len),
            Some(MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES)
        );
        // The total is the stream's, not the excerpt's, which is what says the
        // prefix is a prefix.
        assert_eq!(ours.total_bytes(), long.len() as u64);

        // And the other way: the boundary cut the stream and what it kept fits
        // here whole.
        let theirs = BackendTextExcerpt::of_stream(b"short", 9_000_000, true, &redactor);
        assert!(theirs.capture_truncated());
        assert!(!theirs.excerpt_truncated());
        assert_eq!(theirs.total_bytes(), 9_000_000);
        assert_eq!(theirs.captured_bytes(), 5);
    }

    /// The bound is applied at a character boundary, so a multi-byte character
    /// cut in half never reaches a UTF-8 string.
    #[test]
    fn the_excerpt_bound_never_splits_a_character() {
        let redactor = Redactor::default();
        let mut captured = "样"
            .repeat(MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES)
            .into_bytes();
        captured.truncate(MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES + 2);

        let excerpt = excerpt(&captured, &redactor);
        let text = excerpt.text().expect("nothing here looks like a path");

        assert!(excerpt.excerpt_truncated());
        assert!(text.len() <= MAX_DIAGNOSTIC_STREAM_EXCERPT_BYTES);
        assert!(text.chars().all(|character| character == '样'));
    }

    /// A `{:?}` of anything holding an excerpt must not print the excerpt.
    #[test]
    fn an_excerpt_renders_opaquely() {
        let redactor = Redactor::default();
        let rendered = format!("{:?}", excerpt(b"secret backend chatter", &redactor));

        assert!(rendered.contains("<opaque-backend-excerpt>"), "{rendered}");
        assert!(!rendered.contains("secret"), "{rendered}");
        assert!(!rendered.contains("chatter"), "{rendered}");
    }

    /// A path inside quotes is one the boundaries recognise on both sides.
    #[test]
    fn quoted_and_bracketed_paths_are_redacted() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Data\run.raw"), "<source>");

        for (text, expected) in [
            (r#"input="C:\Data\run.raw""#, r#"input="<source>""#),
            (r"input='C:\Data\run.raw'", "input='<source>'"),
            (r"input=(C:\Data\run.raw)", "input=(<source>)"),
            (r"input=[C:\Data\run.raw]", "input=[<source>]"),
        ] {
            assert_eq!(redactor.redact(text), expected, "{text}");
        }
    }

    /// The user profile is the one location a backend can name without this
    /// process ever having handed it over, so a fresh redactor knows it.
    #[test]
    fn a_fresh_redactor_knows_the_user_profile() {
        let Some(profile) = std::env::var_os("USERPROFILE").or_else(|| std::env::var_os("HOME"))
        else {
            return;
        };
        let profile = Path::new(&profile);
        if !is_absolute_path(profile) {
            return;
        }

        let redacted = Redactor::new().redact(&format!("home is {}", profile.display()));

        assert!(redacted.contains("<user-profile>"), "{redacted}");
    }

    #[cfg(windows)]
    #[test]
    fn canonical_and_obtainable_short_long_aliases_are_registered() {
        use std::time::{SystemTime, UNIX_EPOCH};

        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock should be after Unix epoch")
            .as_nanos();
        let root = std::env::temp_dir().join(format!(
            "mscanvas-redaction-{}-{unique}",
            std::process::id()
        ));
        let directory = root.join("Long Evidence Directory");
        let file = directory.join("Long Scientific File.mzML");
        std::fs::create_dir_all(&directory).expect("test directory should be created");
        std::fs::write(&file, b"fixture").expect("test file should be created");

        let canonical = std::fs::canonicalize(&file).expect("test file should canonicalize");
        let short = win32_short_path(&file);
        let long_from_short = short.as_deref().and_then(win32_long_path);
        let redactor = Redactor::default().with_path(&file, "<fixture>");

        assert_eq!(redactor.redact(&canonical.to_string_lossy()), "<fixture>");
        if let Some(short) = &short {
            assert_eq!(redactor.redact(&short.to_string_lossy()), "<fixture>");
        }
        if let (Some(short), Some(long)) = (&short, &long_from_short) {
            let reverse = Redactor::default().with_path(short, "<fixture>");
            assert_eq!(reverse.redact(&long.to_string_lossy()), "<fixture>");
        }

        std::fs::remove_dir_all(&root).expect("test directory should be removed");
    }
}
