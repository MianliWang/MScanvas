//! One attempt's own directory in the work area: how it is made, how it is
//! marked as MSCanvas's, and how a later attempt tells what a crash left
//! behind from everything else.
//!
//! ## The marker
//!
//! Every attempt directory is created fresh under a new UUID and, before
//! anything else is put in it, given `owner.json`: its schema, the attempt's
//! own name, and which process made it -- the process id with that process's
//! creation time, a pair that names one process and never a later one that
//! reuses the id. No path, source name, output or message is in it.
//!
//! There is no publication state in it because nothing here is ever
//! published. A validated result is staged in the project's store beside the
//! document, never in the work area, so an attempt directory holds scratch
//! only: the source's execution view, the request, the adapter and whatever
//! the worker wrote.
//!
//! ## What a sweep removes
//!
//! A directory directly below the attempts root, and only when every one of
//! these holds:
//!
//! - it is a plain directory, not a link or other reparse point, named by a
//!   canonical UUID;
//! - its marker reads, is this schema and names that same UUID;
//! - the process the marker names is gone: no process has its id, or the one
//!   that does was created at another time;
//! - its `source.mzML`, where there is one, is a hard link whose bytes have
//!   another name on the volume -- removing it removes a name, never the last
//!   way to a user's data.
//!
//! Anything else is left exactly as it was found and counted: a directory
//! with no marker (every attempt made before markers existed among them), a
//! marker that does not read, an owner that is running -- this process
//! included, so a directory an unaccounted worker may still use is never
//! touched -- and an owner whose state cannot be asked.
//!
//! Why a gone owner is enough: the worker runs in a Job its owner created
//! with kill-on-close and no inheritable handle
//! (`crates/proteowizard/src/process.rs`, `assign_with`), so the owner's exit
//! closes the Job's last handle and Windows terminates every process in it. A
//! worker does not outlive the process its marker names. A removal that fails
//! before the directory is empty -- a file somebody holds -- stops there and
//! keeps the marker, so the next sweep recognises the remainder. A directory
//! that is empty but cannot itself be removed is left empty and unmarked, and
//! later sweeps leave it too.
//!
//! A sweep runs at the start of each attempt, and in a run's preflight where
//! the copy it needs would not otherwise fit; never on startup or on opening a
//! project, and not in the background.
//!
//! Nothing here lifts a quarantine. A session that could not account for its
//! worker keeps refusing runs until it exits, whatever became of a directory.

use std::cell::Cell;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

use crate::local_document;

use super::LINK_NAME;

const MARKER: &str = "owner.json";
const MARKER_SCHEMA: &str = "mscanvas.targetedMs1.attemptScratch/1";
/// Far more than a marker needs; a larger file is not one.
const MAX_MARKER_BYTES: u64 = 4096;

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Marker {
    schema: String,
    attempt_id: String,
    owner_process_id: u32,
    /// The owner's creation time, in 100 ns intervals since 1601 (UTC).
    owner_process_created: u64,
}

/// One attempt's own directory, removed when the attempt ends however it
/// ends, unless it is kept.
pub(super) struct AttemptDirectory {
    pub(super) path: PathBuf,
    /// Left in place: a worker whose end was not observed may still use it.
    kept: Cell<bool>,
}

impl AttemptDirectory {
    /// A new directory below `root`, marked as this process's.
    ///
    /// `None` where it could not be made or marked; a directory that was made
    /// and could not be marked is removed again, being certainly this
    /// attempt's and holding at most part of a marker.
    pub(super) fn create(root: &Path) -> Option<Self> {
        let (owner_process_id, owner_process_created) = this_process()?;
        let name = uuid::Uuid::new_v4().to_string();
        let path = root.join(&name);
        fs::create_dir(&path).ok()?;
        let marker = serde_json::to_vec(&Marker {
            schema: MARKER_SCHEMA.to_owned(),
            attempt_id: name,
            owner_process_id,
            owner_process_created,
        });
        if marker
            .ok()
            .and_then(|bytes| super::write_new(&path.join(MARKER), &bytes).ok())
            .is_none()
        {
            let _ = fs::remove_dir_all(&path);
            return None;
        }
        Some(Self {
            path,
            kept: Cell::new(false),
        })
    }

    pub(super) fn keep(&self) {
        self.kept.set(true);
    }
}

impl Drop for AttemptDirectory {
    fn drop(&mut self) {
        if !self.kept.get() {
            let _ = remove_owned(&self.path);
        }
    }
}

/// Removes an attempt directory whose ownership is established: everything
/// in it, then its marker, then the directory. `false` where any of that
/// failed, which leaves the marker wherever something else remains.
fn remove_owned(directory: &Path) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return false;
    };
    let mut emptied = true;
    for entry in entries {
        let Ok(entry) = entry else {
            emptied = false;
            continue;
        };
        if entry.file_name() == MARKER {
            continue;
        }
        let path = entry.path();
        // A file or a link by its name; a directory with everything in it.
        // Neither follows a link to somewhere else.
        if fs::remove_file(&path).is_err() && fs::remove_dir_all(&path).is_err() {
            emptied = false;
        }
    }
    emptied && fs::remove_file(directory.join(MARKER)).is_ok() && fs::remove_dir(directory).is_ok()
}

/// What one sweep found.
#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub(super) struct Sweep {
    /// Scratch whose owner is gone, removed whole.
    pub(super) removed: usize,
    /// Scratch of a process that is still running, this one included.
    pub(super) live: usize,
    /// Not established as attempt scratch at all: left as found.
    pub(super) unowned: usize,
    /// Attempt scratch this sweep could not settle -- an owner it could not
    /// ask about, a source link that may be the last name of its bytes, or a
    /// removal that did not finish: left.
    pub(super) uncertain: usize,
}

/// Removes what earlier sessions' attempts left below `root`, and nothing
/// else. See the module documentation for the rule.
pub(super) fn sweep(root: &Path) -> Sweep {
    let mut sweep = Sweep::default();
    let Ok(entries) = fs::read_dir(root) else {
        return sweep;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        match classify(&path) {
            Found::Unowned => sweep.unowned += 1,
            Found::Live => sweep.live += 1,
            Found::Uncertain => sweep.uncertain += 1,
            Found::Abandoned if remove_owned(&path) => sweep.removed += 1,
            Found::Abandoned => sweep.uncertain += 1,
        }
    }
    sweep
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Found {
    Unowned,
    Live,
    Uncertain,
    Abandoned,
}

fn classify(directory: &Path) -> Found {
    let plain = fs::symlink_metadata(directory)
        .is_ok_and(|metadata| metadata.is_dir() && !local_document::is_reparse_point(&metadata));
    let Some(name) = directory.file_name().and_then(|name| name.to_str()) else {
        return Found::Unowned;
    };
    let canonical = uuid::Uuid::parse_str(name).is_ok_and(|id| id.to_string() == name);
    if !plain || !canonical {
        return Found::Unowned;
    }
    let Some(marker) = local_document::read_bounded(&directory.join(MARKER), MAX_MARKER_BYTES)
        .ok()
        .flatten()
        .and_then(|bytes| serde_json::from_slice::<Marker>(&bytes).ok())
        .filter(|marker| marker.schema == MARKER_SCHEMA && marker.attempt_id == name)
    else {
        return Found::Unowned;
    };
    match owner(marker.owner_process_id, marker.owner_process_created) {
        Owner::Alive => Found::Live,
        Owner::Unknown => Found::Uncertain,
        Owner::Gone if link_is_not_the_last_name(&directory.join(LINK_NAME)) => Found::Abandoned,
        Owner::Gone => Found::Uncertain,
    }
}

/// Whether removing `link` would remove only a name: there is nothing there,
/// or it is an ordinary file with at least one other name.
fn link_is_not_the_last_name(link: &Path) -> bool {
    match fs::symlink_metadata(link) {
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(_) => false,
        Ok(_) => local_document::open_for_read(link)
            .ok()
            .filter(|file| {
                file.metadata()
                    .is_ok_and(|metadata| local_document::is_ordinary_file(&metadata))
            })
            .and_then(|file| local_document::link_count_of(&file))
            .is_some_and(|names| names > 1),
    }
}

// ---------------------------------------------------------------------------
// Owners
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Owner {
    Alive,
    Gone,
    Unknown,
}

/// What became of the process a marker names.
fn owner(process_id: u32, created: u64) -> Owner {
    owner_from(process_created(process_id), created)
}

/// The decision, apart from the asking: a process with the id and the same
/// creation time is the owner; no process with the id, or one created at
/// another time, means the owner is gone; anything else is not known.
fn owner_from(found: Result<Option<u64>, ()>, created: u64) -> Owner {
    match found {
        Ok(Some(found)) if found == created => Owner::Alive,
        Ok(_) => Owner::Gone,
        Err(()) => Owner::Unknown,
    }
}

/// This process's id and creation time, the pair its markers carry.
fn this_process() -> Option<(u32, u64)> {
    static OWN: OnceLock<Option<(u32, u64)>> = OnceLock::new();
    *OWN.get_or_init(|| own_creation_time().map(|created| (std::process::id(), created)))
}

#[cfg(windows)]
mod platform {
    use std::ffi::c_void;
    use std::os::windows::io::{AsRawHandle as _, FromRawHandle as _, OwnedHandle};

    /// PROCESS_QUERY_LIMITED_INFORMATION: enough to read a process's times,
    /// granted for nearly every process.
    const QUERY_LIMITED: u32 = 0x1000;
    /// ERROR_INVALID_PARAMETER: what opening an id no process has answers.
    const NO_SUCH_PROCESS: i32 = 87;

    #[repr(C)]
    #[derive(Default)]
    struct FileTime {
        low: u32,
        high: u32,
    }

    #[link(name = "kernel32")]
    unsafe extern "system" {
        #[link_name = "OpenProcess"]
        fn open_process(access: u32, inherit: i32, process_id: u32) -> *mut c_void;
        #[link_name = "GetCurrentProcess"]
        fn get_current_process() -> *mut c_void;
        #[link_name = "GetProcessTimes"]
        fn get_process_times(
            process: *mut c_void,
            creation: *mut FileTime,
            exit: *mut FileTime,
            kernel: *mut FileTime,
            user: *mut FileTime,
        ) -> i32;
    }

    fn creation_of(process: *mut c_void) -> Option<u64> {
        let mut times = [
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
            FileTime::default(),
        ];
        let [creation, exit, kernel, user] = &mut times;
        // SAFETY: the handle is live for the call and every out parameter is
        // a valid, initialized FILETIME.
        let answered = unsafe { get_process_times(process, creation, exit, kernel, user) };
        (answered != 0).then(|| (u64::from(creation.high) << 32) | u64::from(creation.low))
    }

    pub(super) fn own_creation_time() -> Option<u64> {
        // SAFETY: returns a pseudo handle that needs no closing.
        creation_of(unsafe { get_current_process() })
    }

    pub(super) fn process_created(process_id: u32) -> Result<Option<u64>, ()> {
        // SAFETY: no pointer is passed; a null answer is checked before use.
        let raw = unsafe { open_process(QUERY_LIMITED, 0, process_id) };
        if raw.is_null() {
            return match std::io::Error::last_os_error().raw_os_error() {
                Some(NO_SUCH_PROCESS) => Ok(None),
                _ => Err(()),
            };
        }
        // SAFETY: OpenProcess returned a new, non-null handle owned from here.
        let process = unsafe { OwnedHandle::from_raw_handle(raw) };
        creation_of(process.as_raw_handle()).map(Some).ok_or(())
    }
}

#[cfg(windows)]
use platform::{own_creation_time, process_created};

/// No process identity this build trusts off Windows: nothing is marked, so
/// nothing is made and nothing is swept.
#[cfg(not(windows))]
fn own_creation_time() -> Option<u64> {
    None
}

#[cfg(not(windows))]
fn process_created(_process_id: u32) -> Result<Option<u64>, ()> {
    Err(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(windows)]
    use crate::project::tests::Scratch;

    #[cfg(windows)]
    fn marked(root: &Path, process_id: u32, created: u64) -> PathBuf {
        let name = uuid::Uuid::new_v4().to_string();
        let path = root.join(&name);
        fs::create_dir(&path).expect("directory");
        let marker = Marker {
            schema: MARKER_SCHEMA.to_owned(),
            attempt_id: name,
            owner_process_id: process_id,
            owner_process_created: created,
        };
        fs::write(
            path.join(MARKER),
            serde_json::to_vec(&marker).expect("json"),
        )
        .expect("marker");
        fs::create_dir(path.join("out")).expect("out");
        fs::write(path.join("out").join("rows.jsonl"), b"{}\n").expect("scratch");
        fs::write(path.join("snapshot.mzML"), b"<mzML/>").expect("scratch");
        path
    }

    /// An id no process can have: Windows process ids are multiples of four.
    #[cfg(windows)]
    const NOBODY: u32 = 0xFFFF_FFFD;

    #[test]
    fn the_owner_decision_is_the_id_and_the_creation_time_together() {
        assert_eq!(owner_from(Ok(Some(7)), 7), Owner::Alive);
        assert_eq!(owner_from(Ok(Some(8)), 7), Owner::Gone, "the id was reused");
        assert_eq!(
            owner_from(Ok(None), 7),
            Owner::Gone,
            "no process has the id"
        );
        assert_eq!(owner_from(Err(()), 7), Owner::Unknown, "could not be asked");
    }

    #[cfg(windows)]
    #[test]
    fn this_process_is_alive_and_an_id_nobody_has_is_gone() {
        let (id, created) = this_process().expect("this process has an identity");
        assert_eq!(owner(id, created), Owner::Alive);
        assert_eq!(owner(id, created + 1), Owner::Gone);
        assert_eq!(owner(NOBODY, created), Owner::Gone);
    }

    #[cfg(windows)]
    #[test]
    fn a_sweep_removes_only_scratch_whose_owner_is_gone() {
        let root = Scratch::new("sweep");
        let (id, created) = this_process().expect("identity");
        let gone = marked(root.directory(), NOBODY, 1);
        let reused = marked(root.directory(), id, created.wrapping_sub(1));
        let mine = marked(root.directory(), id, created);

        // What is not provably attempt scratch, however much it looks like it.
        let no_marker = root.directory().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&no_marker).expect("dir");
        fs::write(no_marker.join("snapshot.mzML"), b"x").expect("file");
        let wrong_name = marked(root.directory(), NOBODY, 1);
        let other_name = root.directory().join(uuid::Uuid::new_v4().to_string());
        fs::rename(&wrong_name, &other_name).expect("rename");
        let bad_marker = root.directory().join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&bad_marker).expect("dir");
        fs::write(bad_marker.join(MARKER), b"{\"schema\":1}").expect("marker");
        let not_uuid = root.directory().join("results");
        fs::create_dir(&not_uuid).expect("dir");
        let loose = root.directory().join("notes.txt");
        fs::write(&loose, b"kept").expect("file");
        let upper = marked(root.directory(), NOBODY, 1);
        let upper_name = root.directory().join(
            upper
                .file_name()
                .expect("name")
                .to_str()
                .expect("utf-8")
                .to_ascii_uppercase(),
        );
        fs::rename(&upper, &upper_name).expect("rename");

        let swept = sweep(root.directory());
        assert_eq!(
            swept,
            Sweep {
                removed: 2,
                live: 1,
                unowned: 6,
                uncertain: 0
            }
        );
        assert!(!gone.exists() && !reused.exists());
        for kept in [
            &mine,
            &no_marker,
            &other_name,
            &bad_marker,
            &not_uuid,
            &loose,
            &upper_name,
        ] {
            assert!(kept.exists(), "{}", kept.display());
        }
        assert!(
            mine.join("snapshot.mzML").is_file(),
            "a live owner's scratch is whole"
        );
        assert!(no_marker.join("snapshot.mzML").is_file());
    }

    #[cfg(windows)]
    #[test]
    fn a_process_that_has_exited_is_gone_and_one_that_runs_is_not() {
        use std::process::{Command, Stdio};

        let root = Scratch::new("sweep-process");
        let mut running = Command::new("cmd")
            .args(["/D", "/C", "set /p unused="])
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .spawn()
            .expect("a child that waits for its input");
        let running_created = process_created(running.id())
            .expect("asked")
            .expect("it exists");
        let alive = marked(root.directory(), running.id(), running_created);

        let mut finished = Command::new("cmd")
            .args(["/D", "/C", "exit 0"])
            .stdout(Stdio::null())
            .spawn()
            .expect("a child that exits");
        let finished_id = finished.id();
        let finished_created = process_created(finished_id)
            .expect("asked")
            .expect("held open by this handle");
        finished.wait().expect("exited");
        drop(finished);
        // Its object goes once the last handle to it does, which is not
        // instantaneous; the sweep is asked only once it has.
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
        while owner(finished_id, finished_created) != Owner::Gone {
            assert!(
                std::time::Instant::now() < deadline,
                "the exited child's object persists"
            );
            std::thread::sleep(std::time::Duration::from_millis(20));
        }
        let dead = marked(root.directory(), finished_id, finished_created);

        let swept = sweep(root.directory());
        let _ = running.kill();
        let _ = running.wait();
        assert_eq!((swept.removed, swept.live), (1, 1), "{swept:?}");
        assert!(!dead.exists());
        assert!(alive.join("snapshot.mzML").is_file());
    }

    #[cfg(windows)]
    #[test]
    fn a_source_link_that_may_be_the_last_name_of_its_bytes_keeps_its_directory() {
        let root = Scratch::new("sweep-link");
        let user = root.directory().join("user-data");
        fs::create_dir(&user).expect("dir");
        let original = user.join("run.mzML");
        fs::write(&original, b"the user's bytes").expect("user file");

        let linked = marked(root.directory(), NOBODY, 1);
        fs::hard_link(&original, linked.join(LINK_NAME)).expect("link");
        let orphaned = marked(root.directory(), NOBODY, 1);
        let only = user.join("deleted-later.mzML");
        fs::write(&only, b"bytes whose other name went").expect("user file");
        fs::hard_link(&only, orphaned.join(LINK_NAME)).expect("link");
        fs::remove_file(&only).expect("the user removed their name");

        let swept = sweep(root.directory());
        assert_eq!((swept.removed, swept.uncertain), (1, 1), "{swept:?}");
        assert!(!linked.exists(), "a link with another name is only a name");
        assert_eq!(fs::read(&original).expect("intact"), b"the user's bytes");
        assert_eq!(
            fs::read(orphaned.join(LINK_NAME)).expect("kept"),
            b"bytes whose other name went",
            "the last name of a user's bytes is never removed"
        );
        assert!(orphaned.join(MARKER).is_file());
    }

    /// Windows-specific: a file somebody holds without delete sharing cannot
    /// be removed, and what is left keeps its marker for the next sweep.
    #[cfg(windows)]
    #[test]
    fn a_removal_that_cannot_finish_keeps_its_marker_for_the_next_sweep() {
        use std::os::windows::fs::OpenOptionsExt as _;

        let root = Scratch::new("sweep-held");
        let abandoned = marked(root.directory(), NOBODY, 1);
        let held = fs::OpenOptions::new()
            .read(true)
            .share_mode(0x0000_0001)
            .open(abandoned.join("snapshot.mzML"))
            .expect("hold a scratch file");

        let swept = sweep(root.directory());
        assert_eq!((swept.removed, swept.uncertain), (0, 1), "{swept:?}");
        assert!(
            abandoned.join(MARKER).is_file(),
            "the marker stays with the remainder"
        );
        assert!(abandoned.join("snapshot.mzML").is_file());

        drop(held);
        assert_eq!(sweep(root.directory()).removed, 1);
        assert!(!abandoned.exists());
    }

    #[cfg(windows)]
    #[test]
    fn an_attempt_directory_is_marked_before_use_and_removed_with_everything_in_it() {
        let root = Scratch::new("attempt-directory");
        let directory = AttemptDirectory::create(root.directory()).expect("made");
        let path = directory.path.clone();
        let marker: Marker =
            serde_json::from_slice(&fs::read(path.join(MARKER)).expect("marker")).expect("parses");
        assert_eq!(
            marker.attempt_id,
            path.file_name().expect("name").to_str().expect("utf-8")
        );
        assert_eq!(
            Some((marker.owner_process_id, marker.owner_process_created)),
            this_process()
        );
        fs::write(path.join("snapshot.mzML"), b"x").expect("scratch");
        drop(directory);
        assert!(!path.exists());

        let kept = AttemptDirectory::create(root.directory()).expect("made");
        let kept_path = kept.path.clone();
        kept.keep();
        drop(kept);
        assert!(
            kept_path.join(MARKER).is_file(),
            "a kept directory is left whole"
        );
        assert_eq!(
            sweep(root.directory()).live,
            1,
            "and a sweep in its own session leaves it"
        );
    }
}
