use std::io;
use std::path::Path;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum Sha256Error {
    #[error("SHA-256 calculation through Windows CNG is unavailable on this platform")]
    UnsupportedPlatform,
    #[error("failed to {action} while calculating SHA-256: {source}")]
    Io {
        action: &'static str,
        #[source]
        source: io::Error,
    },
    #[error("Windows CNG operation {operation} failed with NTSTATUS 0x{status:08X}")]
    WindowsCng {
        operation: &'static str,
        status: u32,
    },
    #[error("Windows CNG reported an unexpected SHA-256 digest length: {0}")]
    UnexpectedDigestLength(u32),
    #[error("Windows CNG returned an invalid property length for {property}: {actual}")]
    InvalidPropertyLength { property: &'static str, actual: u32 },
}

#[cfg(windows)]
pub(crate) fn digest_bytes(bytes: &[u8]) -> Result<[u8; 32], Sha256Error> {
    let mut hasher = windows::WindowsSha256::new()?;
    hasher.update(bytes)?;
    hasher.finish()
}

#[cfg(not(windows))]
pub(crate) fn digest_bytes(_bytes: &[u8]) -> Result<[u8; 32], Sha256Error> {
    Err(Sha256Error::UnsupportedPlatform)
}

#[cfg(windows)]
pub(crate) fn digest_file(path: &Path) -> Result<[u8; 32], Sha256Error> {
    use std::fs::File;

    let file = File::open(path).map_err(|source| Sha256Error::Io {
        action: "open the input file",
        source,
    })?;
    digest_reader(file)
}

#[cfg(not(windows))]
pub(crate) fn digest_file(_path: &Path) -> Result<[u8; 32], Sha256Error> {
    Err(Sha256Error::UnsupportedPlatform)
}

/// Digests whatever the reader yields, so a caller that already holds the exact
/// object it means to measure never has to reopen it by name.
#[cfg(windows)]
pub(crate) fn digest_reader<R: std::io::Read>(reader: R) -> Result<[u8; 32], Sha256Error> {
    use std::io::{BufReader, Read};

    let mut reader = BufReader::with_capacity(64 * 1024, reader);
    let mut hasher = windows::WindowsSha256::new()?;
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer).map_err(|source| Sha256Error::Io {
            action: "read the input file",
            source,
        })?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count])?;
    }
    hasher.finish()
}

#[cfg(not(windows))]
pub(crate) fn digest_reader<R: std::io::Read>(_reader: R) -> Result<[u8; 32], Sha256Error> {
    Err(Sha256Error::UnsupportedPlatform)
}

#[cfg(windows)]
mod windows {
    use std::ffi::c_void;
    use std::ptr;

    use super::Sha256Error;

    type AlgorithmHandle = *mut c_void;
    type HashHandle = *mut c_void;

    const SHA256_ALGORITHM: &[u16] = &[
        b'S' as u16,
        b'H' as u16,
        b'A' as u16,
        b'2' as u16,
        b'5' as u16,
        b'6' as u16,
        0,
    ];
    const OBJECT_LENGTH: &[u16] = &[
        b'O' as u16,
        b'b' as u16,
        b'j' as u16,
        b'e' as u16,
        b'c' as u16,
        b't' as u16,
        b'L' as u16,
        b'e' as u16,
        b'n' as u16,
        b'g' as u16,
        b't' as u16,
        b'h' as u16,
        0,
    ];
    const HASH_DIGEST_LENGTH: &[u16] = &[
        b'H' as u16,
        b'a' as u16,
        b's' as u16,
        b'h' as u16,
        b'D' as u16,
        b'i' as u16,
        b'g' as u16,
        b'e' as u16,
        b's' as u16,
        b't' as u16,
        b'L' as u16,
        b'e' as u16,
        b'n' as u16,
        b'g' as u16,
        b't' as u16,
        b'h' as u16,
        0,
    ];

    pub(super) struct WindowsSha256 {
        // Field order is deliberate: the hash is destroyed before its backing
        // object and algorithm provider are released.
        hash: OwnedHashHandle,
        _object: Vec<u8>,
        _algorithm: OwnedAlgorithmHandle,
    }

    impl WindowsSha256 {
        pub(super) fn new() -> Result<Self, Sha256Error> {
            let mut raw_algorithm = ptr::null_mut();
            check_status(
                // SAFETY: the output pointer is valid and the algorithm name is
                // a static NUL-terminated UTF-16 string.
                unsafe {
                    bcrypt_open_algorithm_provider(
                        &mut raw_algorithm,
                        SHA256_ALGORITHM.as_ptr(),
                        ptr::null(),
                        0,
                    )
                },
                "BCryptOpenAlgorithmProvider",
            )?;
            let algorithm = OwnedAlgorithmHandle(raw_algorithm);

            let object_length = get_u32_property(algorithm.0, OBJECT_LENGTH, "ObjectLength")?;
            let digest_length =
                get_u32_property(algorithm.0, HASH_DIGEST_LENGTH, "HashDigestLength")?;
            if digest_length != 32 {
                return Err(Sha256Error::UnexpectedDigestLength(digest_length));
            }

            let mut object = vec![0_u8; object_length as usize];
            let mut raw_hash = ptr::null_mut();
            check_status(
                // SAFETY: the provider is live; `object` is a writable buffer
                // of the stated size and outlives the returned hash handle.
                unsafe {
                    bcrypt_create_hash(
                        algorithm.0,
                        &mut raw_hash,
                        object.as_mut_ptr(),
                        object_length,
                        ptr::null_mut(),
                        0,
                        0,
                    )
                },
                "BCryptCreateHash",
            )?;

            Ok(Self {
                hash: OwnedHashHandle(raw_hash),
                _object: object,
                _algorithm: algorithm,
            })
        }

        pub(super) fn update(&mut self, bytes: &[u8]) -> Result<(), Sha256Error> {
            for chunk in bytes.chunks(u32::MAX as usize) {
                check_status(
                    // SAFETY: the hash handle is live and the byte slice is a
                    // readable buffer of the stated length. CNG does not retain it.
                    unsafe {
                        bcrypt_hash_data(
                            self.hash.0,
                            chunk.as_ptr().cast_mut(),
                            chunk.len() as u32,
                            0,
                        )
                    },
                    "BCryptHashData",
                )?;
            }
            Ok(())
        }

        pub(super) fn finish(self) -> Result<[u8; 32], Sha256Error> {
            let mut digest = [0_u8; 32];
            check_status(
                // SAFETY: the hash handle is live and `digest` is a writable
                // 32-byte buffer, matching the verified provider property.
                unsafe {
                    bcrypt_finish_hash(self.hash.0, digest.as_mut_ptr(), digest.len() as u32, 0)
                },
                "BCryptFinishHash",
            )?;
            Ok(digest)
        }
    }

    struct OwnedAlgorithmHandle(AlgorithmHandle);

    impl Drop for OwnedAlgorithmHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: this wrapper uniquely owns the provider handle.
                let _ = unsafe { bcrypt_close_algorithm_provider(self.0, 0) };
            }
        }
    }

    struct OwnedHashHandle(HashHandle);

    impl Drop for OwnedHashHandle {
        fn drop(&mut self) {
            if !self.0.is_null() {
                // SAFETY: this wrapper uniquely owns the hash handle.
                let _ = unsafe { bcrypt_destroy_hash(self.0) };
            }
        }
    }

    fn get_u32_property(
        object: *mut c_void,
        name: &'static [u16],
        label: &'static str,
    ) -> Result<u32, Sha256Error> {
        let mut value = 0_u32;
        let mut returned = 0_u32;
        check_status(
            // SAFETY: the object handle is live; the property name is
            // NUL-terminated and the output pointers target valid u32 values.
            unsafe {
                bcrypt_get_property(
                    object,
                    name.as_ptr(),
                    (&mut value as *mut u32).cast(),
                    size_of::<u32>() as u32,
                    &mut returned,
                    0,
                )
            },
            "BCryptGetProperty",
        )?;
        if returned != size_of::<u32>() as u32 {
            return Err(Sha256Error::InvalidPropertyLength {
                property: label,
                actual: returned,
            });
        }
        Ok(value)
    }

    fn check_status(status: i32, operation: &'static str) -> Result<(), Sha256Error> {
        if status >= 0 {
            Ok(())
        } else {
            Err(Sha256Error::WindowsCng {
                operation,
                status: status as u32,
            })
        }
    }

    #[link(name = "bcrypt")]
    unsafe extern "system" {
        #[link_name = "BCryptOpenAlgorithmProvider"]
        fn bcrypt_open_algorithm_provider(
            algorithm: *mut AlgorithmHandle,
            algorithm_id: *const u16,
            implementation: *const u16,
            flags: u32,
        ) -> i32;
        #[link_name = "BCryptCloseAlgorithmProvider"]
        fn bcrypt_close_algorithm_provider(algorithm: AlgorithmHandle, flags: u32) -> i32;
        #[link_name = "BCryptGetProperty"]
        fn bcrypt_get_property(
            object: *mut c_void,
            property: *const u16,
            output: *mut u8,
            output_length: u32,
            result_length: *mut u32,
            flags: u32,
        ) -> i32;
        #[link_name = "BCryptCreateHash"]
        fn bcrypt_create_hash(
            algorithm: AlgorithmHandle,
            hash: *mut HashHandle,
            hash_object: *mut u8,
            hash_object_length: u32,
            secret: *mut u8,
            secret_length: u32,
            flags: u32,
        ) -> i32;
        #[link_name = "BCryptHashData"]
        fn bcrypt_hash_data(hash: HashHandle, input: *mut u8, input_length: u32, flags: u32)
        -> i32;
        #[link_name = "BCryptFinishHash"]
        fn bcrypt_finish_hash(
            hash: HashHandle,
            output: *mut u8,
            output_length: u32,
            flags: u32,
        ) -> i32;
        #[link_name = "BCryptDestroyHash"]
        fn bcrypt_destroy_hash(hash: HashHandle) -> i32;
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    #[test]
    fn windows_cng_matches_known_sha256_vectors() {
        assert_eq!(
            digest_bytes(b"").expect("empty digest"),
            [
                0xe3, 0xb0, 0xc4, 0x42, 0x98, 0xfc, 0x1c, 0x14, 0x9a, 0xfb, 0xf4, 0xc8, 0x99, 0x6f,
                0xb9, 0x24, 0x27, 0xae, 0x41, 0xe4, 0x64, 0x9b, 0x93, 0x4c, 0xa4, 0x95, 0x99, 0x1b,
                0x78, 0x52, 0xb8, 0x55,
            ]
        );
        assert_eq!(
            digest_bytes(b"abc").expect("abc digest"),
            [
                0xba, 0x78, 0x16, 0xbf, 0x8f, 0x01, 0xcf, 0xea, 0x41, 0x41, 0x40, 0xde, 0x5d, 0xae,
                0x22, 0x23, 0xb0, 0x03, 0x61, 0xa3, 0x96, 0x17, 0x7a, 0x9c, 0xb4, 0x10, 0xff, 0x61,
                0xf2, 0x00, 0x15, 0xad,
            ]
        );
    }

    #[cfg(not(windows))]
    #[test]
    fn unsupported_platform_fails_closed() {
        assert!(matches!(
            digest_bytes(b"abc"),
            Err(Sha256Error::UnsupportedPlatform)
        ));
    }
}
