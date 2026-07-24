use std::path::Path;

use crate::{ProcessOutput, Termination};

#[derive(Clone, Default, PartialEq, Eq)]
pub struct Redactor {
    replacements: Vec<(String, String)>,
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
        redactor
    }

    #[must_use]
    pub fn with_path(mut self, path: &Path, replacement: impl Into<String>) -> Self {
        self.add_path(path, replacement);
        self
    }

    pub fn add_path(&mut self, path: &Path, replacement: impl Into<String>) {
        let value = path.to_string_lossy();
        if value.is_empty() {
            return;
        }
        let replacement = replacement.into();
        self.add_literal(&value, &replacement);
        self.add_literal(&value.replace('\\', "/"), &replacement);
    }

    pub fn add_literal(&mut self, value: &str, replacement: &str) {
        if value.is_empty() {
            return;
        }
        self.replacements
            .push((value.to_owned(), replacement.to_owned()));
        self.replacements
            .sort_by_key(|entry| std::cmp::Reverse(entry.0.len()));
        self.replacements.dedup();
    }

    #[must_use]
    pub fn redact(&self, text: &str) -> String {
        self.replacements
            .iter()
            .fold(text.to_owned(), |redacted, (value, replacement)| {
                replace_case_insensitive(&redacted, value, replacement)
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn local_paths_are_redacted_case_insensitively_in_both_separator_styles() {
        let redactor = Redactor::default().with_path(
            Path::new(r"C:\Users\Local User\Mass Spec\sample 01.raw"),
            "<input>",
        );

        let text = concat!(
            r"Failed C:\USERS\LOCAL USER\Mass Spec\sample 01.raw; ",
            "retry C:/Users/Local User/Mass Spec/sample 01.raw"
        );
        let redacted = redactor.redact(text);

        assert_eq!(redacted, "Failed <input>; retry <input>");
        assert!(!redacted.contains("Local User"));
        assert!(!redacted.contains("sample 01"));
    }

    #[test]
    fn unicode_path_bytes_are_preserved_while_ascii_drive_case_is_ignored() {
        let redactor = Redactor::default().with_path(Path::new(r"C:\Data\样本 01.raw"), "<input>");

        assert_eq!(redactor.redact(r"c:\data\样本 01.raw"), "<input>");
    }
}
