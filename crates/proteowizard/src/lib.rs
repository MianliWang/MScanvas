//! Typed command planning for user-installed ProteoWizard tools.

use std::path::{Path, PathBuf};

use thiserror::Error;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OpenFormat {
    MzMl,
    MzXml,
}

impl OpenFormat {
    fn argument(self) -> &'static str {
        match self {
            Self::MzMl => "--mzML",
            Self::MzXml => "--mzXML",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CommandSpec {
    pub executable: PathBuf,
    pub args: Vec<String>,
    pub working_directory: PathBuf,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum PlanError {
    #[error("input path has no file name")]
    MissingInputName,
    #[error("output directory must not be empty")]
    MissingOutputDirectory,
}

pub fn build_msconvert_command(
    executable: impl Into<PathBuf>,
    input: &Path,
    output_directory: &Path,
    format: OpenFormat,
) -> Result<CommandSpec, PlanError> {
    if input.file_name().is_none() {
        return Err(PlanError::MissingInputName);
    }
    if output_directory.as_os_str().is_empty() {
        return Err(PlanError::MissingOutputDirectory);
    }

    Ok(CommandSpec {
        executable: executable.into(),
        args: vec![
            input.to_string_lossy().into_owned(),
            format.argument().to_owned(),
            "--zlib".to_owned(),
            "--outdir".to_owned(),
            output_directory.to_string_lossy().into_owned(),
        ],
        working_directory: output_directory.to_path_buf(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn paths_with_spaces_are_kept_as_single_argv_values() {
        let command = build_msconvert_command(
            r"C:\Program Files\ProteoWizard\msconvert.exe",
            Path::new(r"D:\Mass Spec Data\样本 01.raw"),
            Path::new(r"D:\Mass Spec Data\converted"),
            OpenFormat::MzMl,
        )
        .expect("valid command");

        assert_eq!(command.args[0], r"D:\Mass Spec Data\样本 01.raw");
        assert_eq!(command.args[1], "--mzML");
        assert_eq!(command.args[3], "--outdir");
        assert_eq!(command.args.len(), 5);
    }

    #[test]
    fn mzxml_is_an_explicit_legacy_format_argument() {
        let command = build_msconvert_command(
            "msconvert",
            Path::new("sample.raw"),
            Path::new("converted"),
            OpenFormat::MzXml,
        )
        .expect("valid command");

        assert!(command.args.contains(&"--mzXML".to_owned()));
        assert!(!command.args.contains(&"--mzML".to_owned()));
    }
}
