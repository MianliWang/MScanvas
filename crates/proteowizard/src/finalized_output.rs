//! The authority a finalized conversion output leaves behind.
//!
//! Finalization used to end by releasing the object it had just renamed. That
//! was correct for everything finalization itself promises — the report is a
//! statement about bytes that were read, and reading was over. It is not enough
//! for anything that wants to *use* the output later, because between the
//! rename and that later moment the final name is an ordinary name: it can be
//! given to a different object, and the object it named can be deleted and its
//! file id reissued.
//!
//! So the object is retained instead. Not the handle that renamed it: that one
//! was opened to be renameable, which means it withholds write sharing, and
//! keeping it would quietly forbid the user from writing to their own finished
//! file for as long as the queue's result stayed on screen. The renamed object
//! is reopened *from that handle* instead — `ReOpenFile` names an object, not a
//! path, so this is the same object by construction and not by a second lookup
//! — with the same fully permissive sharing the workspace's own file leases
//! use, and the renameable handle is then released.
//!
//! What the retained handle buys is exactly one thing: the object cannot cease
//! to exist while it is held, so its identity cannot be reissued to something
//! else. It deliberately buys nothing else. The user may write to, rename, or
//! delete the output, and all three are ordinary things to do with a file in a
//! folder they chose.
//!
//! Because writes are permitted, identity alone cannot answer whether the bytes
//! are still the validated ones — so [`FinalizedOutput::still_matches`] asks
//! both questions, and the caller is expected to hand it an object it opened
//! while denying writers, so that the answer cannot go stale between the check
//! and the use.
//!
//! What this is not: a lock on the file, a claim it will still be there, or a
//! record that survives the process. It is one session-scoped way to ask "is
//! that still this?" and to be answered from the object rather than the name.

use std::fmt;
use std::fs::File;

use crate::capability::Sha256Digest;
use crate::conversion::ValidConversion;

/// Why a finalized output can no longer be taken to be the one that was
/// validated.
///
/// Closed and coarse on purpose. A caller decides whether to admit the file,
/// and every member here is the same decision — do not — differing only in what
/// it can honestly tell the user.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum OutputDrift {
    /// The name resolves to some other object. The finalized one may still
    /// exist elsewhere; this says nothing about where.
    DifferentObject,
    /// The same object, no longer the length it was validated at.
    ByteLengthChanged,
    /// The same object at the same length, holding different bytes.
    ContentChanged,
    /// The object could not be read far enough to decide either way.
    Unreadable,
}

impl OutputDrift {
    #[must_use]
    pub const fn stable_id(self) -> &'static str {
        match self {
            Self::DifferentObject => "different_object",
            Self::ByteLengthChanged => "byte_length_changed",
            Self::ContentChanged => "content_changed",
            Self::Unreadable => "unreadable",
        }
    }
}

/// One finalized conversion output, and the means to recognise it again.
///
/// Holds the exact object the integrity scan read and the rename moved, so
/// "is the file at this name still the one this report describes?" is answered
/// by comparing objects rather than by trusting a name twice.
///
/// Dropping it closes the handle and does nothing else. The output is the
/// user's file, in the folder they chose; nothing here owns it.
pub struct FinalizedOutput {
    /// The renamed object itself, held and never handed out: a caller that
    /// could reach the handle could read around every check below. Underscored
    /// like the destination pin beside it, because holding it *is* the point --
    /// nothing reads it in a production build.
    #[cfg(windows)]
    _object: File,
    /// Read through that handle *after* the rename, so it names the object that
    /// actually received the final name.
    #[cfg(windows)]
    identity: (u64, [u8; 16]),
    valid: ValidConversion,
}

impl FinalizedOutput {
    /// Retains a freshly renamed output.
    ///
    /// Takes the renaming handle by value and does not keep it: what is kept is
    /// a permissive reopen of the same object, so nothing the user might want to
    /// do with their own file is forbidden by MSCanvas still thinking about it.
    ///
    /// Fails when the object cannot be reopened or cannot say what it is, which
    /// are the two states in which retaining it would be retaining something
    /// unidentifiable.
    #[cfg(windows)]
    pub(crate) fn retain(object: File, valid: ValidConversion) -> std::io::Result<Self> {
        let held = reopen_permissively(&object)?;
        // The renaming handle goes now rather than at the end of the scope. It
        // is the one that withholds write sharing, and every moment it is held
        // past its purpose is a moment the user cannot write their own file.
        drop(object);
        let identity = crate::conversion_run::object_identity(&held)?;
        Ok(Self {
            _object: held,
            identity,
            valid,
        })
    }

    /// Records a finalized output on a platform that carries no object-bound
    /// guarantee.
    ///
    /// The non-Windows finalization path links from the staged *name* and says
    /// so; there is no renamed handle to keep, and this does not pretend
    /// otherwise. The byte comparison below still applies.
    #[cfg(not(windows))]
    pub(crate) const fn unbound(valid: ValidConversion) -> Self {
        Self { valid }
    }

    /// What the integrity contract established about this output.
    #[must_use]
    pub const fn valid(&self) -> &ValidConversion {
        &self.valid
    }

    /// The length the output was validated at.
    #[must_use]
    pub const fn byte_length(&self) -> u64 {
        self.valid.output().byte_length()
    }

    /// The digest the output was validated at.
    #[must_use]
    pub const fn sha256(&self) -> Sha256Digest {
        self.valid.output().sha256()
    }

    /// Whether `current` is this exact object, still holding the bytes that
    /// were validated.
    ///
    /// Both halves are required and neither implies the other. Identity alone
    /// admits an object whose bytes were rewritten in place; a digest alone
    /// admits any file that happens to be a copy, including one a caller was
    /// never told about. `current` must be an object the caller opened itself —
    /// this reads it, it does not open it, so the caller keeps control of how
    /// the object was reached and what sharing it was reached under.
    ///
    /// # Errors
    ///
    /// Returns the first way `current` differs, in the order above.
    pub fn still_matches(&self, current: &File) -> Result<(), OutputDrift> {
        self.recognises(current)?;
        self.holds_validated_bytes(current)
    }

    /// Whether `current` is the same object this finalized.
    #[cfg(windows)]
    fn recognises(&self, current: &File) -> Result<(), OutputDrift> {
        let observed =
            crate::conversion_run::object_identity(current).map_err(|_| OutputDrift::Unreadable)?;
        if observed == self.identity {
            return Ok(());
        }
        Err(OutputDrift::DifferentObject)
    }

    /// This platform does not carry the object-bound guarantee, and the
    /// finalization that produced this said the same. Nothing is claimed here
    /// that finalization did not already claim.
    #[cfg(not(windows))]
    #[expect(
        clippy::unused_self,
        clippy::trivially_copy_pass_by_ref,
        reason = "one signature on both platforms"
    )]
    const fn recognises(&self, _current: &File) -> Result<(), OutputDrift> {
        Ok(())
    }

    /// Whether `current` holds the bytes the validation measured.
    ///
    /// Length first, because it is the cheap half and the one that separates
    /// "rewritten" from "identical" without reading the file at all.
    ///
    /// Reads from the beginning rather than from wherever the caller left the
    /// object: a digest taken from an arbitrary offset would answer a different
    /// question and would answer it wrongly. The caller's read position is
    /// therefore moved, which is why this takes an object it does not own.
    fn holds_validated_bytes(&self, current: &File) -> Result<(), OutputDrift> {
        use std::io::Seek;

        let observed = current
            .metadata()
            .map_err(|_| OutputDrift::Unreadable)?
            .len();
        if observed != self.byte_length() {
            return Err(OutputDrift::ByteLengthChanged);
        }
        let mut reader = current;
        reader.rewind().map_err(|_| OutputDrift::Unreadable)?;
        let digest = Sha256Digest::calculate_reader(reader).map_err(|_| OutputDrift::Unreadable)?;
        if digest != self.sha256() {
            return Err(OutputDrift::ContentChanged);
        }
        Ok(())
    }

    /// Whether the retained object still answers at all.
    ///
    /// Used only to prove in tests that the handle is live; production asks
    /// [`Self::still_matches`], which is a question about a *named* object.
    #[cfg(all(test, windows))]
    pub(crate) fn retained_identity(&self) -> std::io::Result<(u64, [u8; 16])> {
        crate::conversion_run::object_identity(&self._object)
    }
}

/// Reopens the object a handle already names, sharing everything.
///
/// `ReOpenFile` is the only Win32 entry point that reaches an object through an
/// existing handle rather than through a name, which is what makes this a
/// retention of *this* object rather than a second lookup that could land
/// somewhere else. The sharing asked for is the same fully permissive set the
/// workspace's own file leases use, for the same reason: the handle exists to
/// keep the object alive, not to take anything away from the person who owns
/// the file.
#[cfg(windows)]
fn reopen_permissively(object: &File) -> std::io::Result<File> {
    use std::ffi::c_void;
    use std::os::windows::io::{AsRawHandle, FromRawHandle, OwnedHandle, RawHandle};

    const FILE_READ_DATA: u32 = 0x0000_0001;
    const FILE_READ_ATTRIBUTES: u32 = 0x0000_0080;
    const SYNCHRONIZE: u32 = 0x0010_0000;
    /// Read, write and delete. Nothing is withheld from anyone else.
    const FILE_SHARE_ALL: u32 = 0x0000_0007;
    const INVALID_HANDLE_VALUE: isize = -1;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "ReOpenFile"]
        fn reopen_file(
            original: *mut c_void,
            desired_access: u32,
            share_mode: u32,
            flags_and_attributes: u32,
        ) -> *mut c_void;
    }

    // SAFETY: `object` owns a live handle for the duration of the call, and the
    // returned handle is adopted by `OwnedHandle` immediately so it has exactly
    // one owner.
    let reopened = unsafe {
        reopen_file(
            object.as_raw_handle(),
            FILE_READ_DATA | FILE_READ_ATTRIBUTES | SYNCHRONIZE,
            FILE_SHARE_ALL,
            0,
        )
    };
    if reopened.cast::<c_void>() as isize == INVALID_HANDLE_VALUE || reopened.is_null() {
        return Err(std::io::Error::last_os_error());
    }
    // SAFETY: the call succeeded, so this is a fresh handle owned by nothing
    // else, and it is a file handle because `object` is one.
    let owned = unsafe { OwnedHandle::from_raw_handle(reopened.cast::<c_void>() as RawHandle) };
    Ok(File::from(owned))
}

/// Deliberately opaque. Neither the handle nor the identity may be rendered:
/// one is a capability and the other names a place on the user's disk.
impl fmt::Debug for FinalizedOutput {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        formatter
            .debug_struct("FinalizedOutput")
            .field("object", &"<opaque-finalized-output>")
            .field("fully_verified", &self.valid.is_fully_verified())
            .finish_non_exhaustive()
    }
}

/// Equality over what was established, not over which handle holds it.
///
/// Two retentions of the same object are the same finalized output; the handles
/// are distinct kernel objects and comparing them would make every report
/// unequal to itself after a round trip. The identity is compared because it is
/// a fact about the output, unlike the handle.
impl PartialEq for FinalizedOutput {
    fn eq(&self, other: &Self) -> bool {
        #[cfg(windows)]
        {
            self.identity == other.identity && self.valid == other.valid
        }
        #[cfg(not(windows))]
        {
            self.valid == other.valid
        }
    }
}
