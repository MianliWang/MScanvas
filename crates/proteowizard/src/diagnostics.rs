use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::{ProcessOutput, Termination};

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
        self.replacements
            .iter()
            .fold(text.to_owned(), |redacted, entry| match entry.kind {
                ReplacementKind::Literal => {
                    replace_case_insensitive(&redacted, &entry.value, &entry.replacement)
                }
                ReplacementKind::Path => {
                    replace_path_alias(&redacted, &entry.value, &entry.replacement)
                }
            })
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

fn replace_path_alias(input: &str, alias: &str, replacement: &str) -> String {
    let mut result = String::with_capacity(input.len());
    let mut cursor = 0;

    while let Some((start, end)) = find_path_alias(input, alias, cursor) {
        result.push_str(&input[cursor..start]);
        result.push_str(replacement);
        cursor = end;
    }

    result.push_str(&input[cursor..]);
    result
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

    input[end..]
        .chars()
        .next()
        .is_some_and(|character| is_separator(character) || is_path_delimiter(character))
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

fn replace_case_insensitive(input: &str, needle: &str, replacement: &str) -> String {
    if needle.is_empty() {
        return input.to_owned();
    }

    let mut result = String::with_capacity(input.len());
    let mut cursor = 0;
    while let Some(start) = find_ascii_case_insensitive(input, needle, cursor) {
        let end = start + needle.len();
        result.push_str(&input[cursor..start]);
        result.push_str(replacement);
        cursor = end;
    }
    result.push_str(&input[cursor..]);
    result
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
