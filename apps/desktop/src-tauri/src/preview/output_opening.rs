//! One fixed Windows handoff for an object the service has already admitted.
//!
//! There is no frontend path or verb API. The caller keeps its identity and
//! writer-exclusion holds alive until this function returns. Acceptance means
//! the Shell accepted the request, not that a handler rendered the document or
//! that MSCanvas can control its lifetime after delegation.

use std::path::Path;

use super::dto::OutputOpenRefusalDto;

#[cfg(windows)]
pub(super) fn open(path: &Path) -> Result<(), OutputOpenRefusalDto> {
    platform::open(path)
}

#[cfg(not(windows))]
pub(super) fn open(_path: &Path) -> Result<(), OutputOpenRefusalDto> {
    Err(OutputOpenRefusalDto::PlatformUnavailable)
}

#[cfg(windows)]
mod platform {
    use std::os::windows::ffi::OsStrExt;

    use windows::Win32::Foundation::{ERROR_ACCESS_DENIED, ERROR_NO_ASSOCIATION};
    use windows::Win32::System::Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize};
    use windows::Win32::UI::Shell::{
        SE_ERR_ACCESSDENIED, SE_ERR_NOASSOC, SEE_MASK_FLAG_NO_UI, SEE_MASK_NOASYNC,
        SHELLEXECUTEINFOW, ShellExecuteExW,
    };
    use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;
    use windows::core::{HRESULT, PCWSTR, w};

    use super::*;

    struct ComApartment;

    impl ComApartment {
        fn initialise() -> Result<Self, OutputOpenRefusalDto> {
            // SAFETY: the reserved pointer is null; this worker requests STA.
            // Both S_OK and S_FALSE are balanced on this same thread by Drop.
            unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) }
                .ok()
                .map_err(|_| OutputOpenRefusalDto::PlatformUnavailable)?;
            Ok(Self)
        }
    }

    impl Drop for ComApartment {
        fn drop(&mut self) {
            // SAFETY: paired with this guard's successful initialization.
            unsafe { CoUninitialize() };
        }
    }

    fn target(path: &Path) -> Result<Vec<u16>, OutputOpenRefusalDto> {
        let mut target: Vec<_> = path.as_os_str().encode_wide().collect();
        if !path.is_absolute() || target.contains(&0) {
            return Err(OutputOpenRefusalDto::PlatformFailure);
        }
        target.push(0);
        Ok(target)
    }

    fn refusal(code: HRESULT, shell_code: usize) -> OutputOpenRefusalDto {
        if code == HRESULT::from_win32(ERROR_NO_ASSOCIATION.0)
            || shell_code == SE_ERR_NOASSOC as usize
        {
            OutputOpenRefusalDto::NoAssociation
        } else if code == HRESULT::from_win32(ERROR_ACCESS_DENIED.0)
            || shell_code == SE_ERR_ACCESSDENIED as usize
        {
            OutputOpenRefusalDto::AccessDenied
        } else {
            OutputOpenRefusalDto::PlatformFailure
        }
    }

    pub(super) fn open(path: &Path) -> Result<(), OutputOpenRefusalDto> {
        let target = target(path)?;
        let _apartment = ComApartment::initialise()?;
        let mut request = SHELLEXECUTEINFOW {
            cbSize: std::mem::size_of::<SHELLEXECUTEINFOW>() as u32,
            // Wait for the Shell handoff on this short-lived worker; no error
            // dialog, arbitrary arguments, registry key, URL or alternate verb.
            fMask: SEE_MASK_NOASYNC | SEE_MASK_FLAG_NO_UI,
            lpVerb: w!("open"),
            lpFile: PCWSTR(target.as_ptr()),
            nShow: SW_SHOWNORMAL.0,
            ..Default::default()
        };
        // SAFETY: the correctly sized structure and NUL-terminated target live
        // through the synchronous handoff. All unused fields remain null/zero.
        // No process handle is requested, and no handler lifetime is asserted.
        unsafe { ShellExecuteExW(&mut request) }
            .map_err(|error| refusal(error.code(), request.hInstApp.0 as usize))
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn a_unicode_space_target_is_one_unchanged_utf16_string() {
            let path = Path::new("C:\\M7.4 output \\sample space 质谱.mzML");
            let encoded = target(path).unwrap();
            assert_eq!(encoded.last(), Some(&0));
            assert_eq!(
                &encoded[..encoded.len() - 1],
                path.as_os_str().encode_wide().collect::<Vec<_>>()
            );
            assert!(target(Path::new("sample.mzML")).is_err());
            assert!(target(Path::new("C:\\sample\0.mzML")).is_err());
        }

        #[test]
        fn shell_failures_remain_typed_refusals() {
            assert_eq!(
                refusal(HRESULT::from_win32(ERROR_NO_ASSOCIATION.0), 0),
                OutputOpenRefusalDto::NoAssociation
            );
            assert_eq!(
                refusal(HRESULT::from_win32(ERROR_ACCESS_DENIED.0), 0),
                OutputOpenRefusalDto::AccessDenied
            );
            assert_eq!(
                refusal(HRESULT::from_win32(8), SE_ERR_NOASSOC as usize),
                OutputOpenRefusalDto::NoAssociation
            );
            assert_eq!(
                refusal(HRESULT::from_win32(8), 0),
                OutputOpenRefusalDto::PlatformFailure
            );
        }
    }
}
