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
//! - it has no entry at the link name (`source.mzML`, in any ASCII case), and
//!   its entries can be listed to show so.
//!
//! Anything else is left exactly as it was found and counted: a directory
//! with no marker (every attempt made before markers existed among them), a
//! marker that does not read, an owner that is running -- this process
//! included, so a directory an unaccounted worker may still use is never
//! touched -- an owner whose state cannot be asked, and a gone owner's
//! directory that holds a link.
//!
//! ## Links are never a sweep's to remove
//!
//! A link attempt's `source.mzML` is another name for the user's source. Once
//! the attempt that made it is gone, nothing holds the source any more, so no
//! check made now -- however many names the bytes have -- still holds when a
//! removal acts on it: the other name can go in between. A sweep therefore
//! never unlinks one. It leaves the whole directory, counted as `linked`, and
//! `remove_owned` refuses the link name on every path, so a link that appears
//! after a directory was judged, or one left by an attempt whose own removal
//! failed, is never unlinked either. The link is only ever made at the
//! directory's top level (`execution_view`), and the one statement that unlinks it is
//! `ExecutionView`'s drop, inside the attempt that made it and while it still
//! holds the source by the name the source was opened through, which Windows
//! then refuses to delete or rename.
//!
//! A copy (`snapshot.mzML`) is created new by the attempt in its own
//! directory and is never another name for anything; which view a directory
//! held is read from these names, which are journaled directory entries, so
//! the marker carries no view field. A crash before either exists leaves only
//! the attempt's own files.
//!
//! Why a gone owner is enough: the worker runs in a Job its owner created
//! with kill-on-close and no inheritable handle
//! (`crates/proteowizard/src/process.rs`, `assign_with`), so the owner's exit
//! closes the Job's last handle and Windows terminates every process in it. A
//! worker stuck in the kernel can outlive that request for a while; the files
//! it still holds then cannot be removed, and the directory keeps its marker
//! for a later sweep. A removal that fails
//! before the directory is empty -- a file somebody holds -- stops there and
//! keeps the marker, so the next sweep recognises the remainder. A directory
//! that is empty but cannot itself be removed is left empty and unmarked, and
//! later sweeps leave it too.
//!
//! A sweep runs at the start of each attempt, and in the preflight of a plan
//! review or of a Run where the copy it needs would not otherwise fit; never on
//! startup or on opening a project, and not in the background. A review is not
//! held off by a run in progress, so two sweeps can overlap in one process;
//! overlapping removals fail softly and the next sweep finishes them.
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
    /// attempt's and holding at most part of a marker -- and only as that:
    /// what else might be in it is not removed.
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
            let _ = fs::remove_file(path.join(MARKER));
            let _ = fs::remove_dir(&path);
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

/// Whether `name` is the execution view's hard-link name, as NTFS compares
/// names: without regard to ASCII case.
fn is_link_name(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|name| name.eq_ignore_ascii_case(LINK_NAME))
}

/// Removes an attempt directory whose ownership is established: everything
/// in it, then its marker, then the directory. `false` where any of that
/// failed, which leaves the marker wherever something else remains.
///
/// Never the link name. Its entry may be a hard link to a user's source, and
/// only the attempt that made it -- while it still holds the source, so the
/// source's own name cannot go first -- may unlink it (`ExecutionView`'s
/// drop, the one statement in this build that does). A directory that still
/// has one is not emptied, and keeps its marker.
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
        if is_link_name(&entry.file_name()) {
            emptied = false;
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
    /// Scratch whose owner is gone and which holds, or may hold, a hard link
    /// to a source: left whole, because a sweep never unlinks one.
    pub(super) linked: usize,
    /// Attempt scratch this sweep could not settle -- an owner it could not
    /// ask about, or a removal that did not finish: left.
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
            Found::Linked => sweep.linked += 1,
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
    Linked,
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
        Owner::Gone if may_hold_a_link(directory) => Found::Linked,
        Owner::Gone => Found::Abandoned,
    }
}

/// Whether `directory` has, or cannot be shown not to have, an entry at the
/// link name. How many other names its bytes have is deliberately not asked:
/// that answer can change before a removal acts on it.
fn may_hold_a_link(directory: &Path) -> bool {
    let Ok(entries) = fs::read_dir(directory) else {
        return true;
    };
    entries
        .into_iter()
        .any(|entry| entry.map_or(true, |entry| is_link_name(&entry.file_name())))
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
                linked: 0,
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

    /// A link attempt of a gone owner, holding a hard link to `bytes` under
    /// `link_name`, whose own name in `user` is kept or removed.
    #[cfg(windows)]
    fn linked(root: &Path, user: &Path, link_name: &str, bytes: &[u8], keep: bool) -> PathBuf {
        let attempt = marked(root, NOBODY, 1);
        fs::remove_file(attempt.join("snapshot.mzML")).expect("a link attempt has no copy");
        let original = user.join(format!("{}.mzML", uuid::Uuid::new_v4()));
        fs::write(&original, bytes).expect("user file");
        fs::hard_link(&original, attempt.join(link_name)).expect("link");
        if !keep {
            fs::remove_file(&original).expect("the user removed their name");
        }
        attempt
    }

    #[cfg(windows)]
    #[test]
    fn a_gone_owners_source_link_is_never_unlinked_however_many_names_it_has() {
        let scratch = Scratch::new("sweep-link");
        let (root, user) = (scratch.join("attempts"), scratch.join("user-data"));
        fs::create_dir(&root).expect("dir");
        fs::create_dir(&user).expect("dir");

        // The user's name is still there; the link is the only name left; and
        // the link under another case of the same name.
        let named = linked(&root, &user, LINK_NAME, b"still named", true);
        let last = linked(&root, &user, LINK_NAME, b"only the link", false);
        let cased = linked(&root, &user, "SOURCE.MZML", b"cased", true);

        let swept = sweep(&root);
        assert_eq!(
            swept,
            Sweep {
                linked: 3,
                ..Sweep::default()
            }
        );
        for (attempt, name, bytes) in [
            (&named, LINK_NAME, &b"still named"[..]),
            (&last, LINK_NAME, &b"only the link"[..]),
            (&cased, "SOURCE.MZML", &b"cased"[..]),
        ] {
            assert_eq!(fs::read(attempt.join(name)).expect("kept"), bytes);
            assert!(attempt.join(MARKER).is_file(), "left whole");
            assert!(
                attempt.join("out").join("rows.jsonl").is_file(),
                "left whole"
            );
        }
        assert_eq!(
            fs::read_dir(&user).expect("user data").count(),
            2,
            "both kept names untouched"
        );
        assert_eq!(sweep(&root).linked, 3, "and left again");
    }

    #[cfg(windows)]
    #[test]
    fn a_source_link_under_a_marker_that_is_not_proof_is_left_as_found() {
        let scratch = Scratch::new("sweep-link-unowned");
        let original = scratch.write("user.mzML", b"user bytes");
        let root = scratch.join("attempts");
        fs::create_dir(&root).expect("dir");

        let unmarked = root.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&unmarked).expect("dir");
        fs::hard_link(&original, unmarked.join(LINK_NAME)).expect("link");
        let malformed = root.join(uuid::Uuid::new_v4().to_string());
        fs::create_dir(&malformed).expect("dir");
        fs::write(
            malformed.join(MARKER),
            b"{\"schema\":\"mscanvas.targetedMs1.attemptScratch/2\"}",
        )
        .expect("marker");
        fs::hard_link(&original, malformed.join(LINK_NAME)).expect("link");

        assert_eq!(
            sweep(&root),
            Sweep {
                unowned: 2,
                ..Sweep::default()
            }
        );
        for attempt in [&unmarked, &malformed] {
            assert_eq!(
                fs::read(attempt.join(LINK_NAME)).expect("kept"),
                b"user bytes"
            );
        }
    }

    /// Removing an attempt's own directory never unlinks a link left in it:
    /// that is `ExecutionView`'s to do while the source is held, and a link it
    /// could not remove stays, with the directory and its marker.
    #[cfg(windows)]
    #[test]
    fn a_directory_removal_leaves_a_link_it_finds_with_the_marker() {
        let root = Scratch::new("attempt-link-left");
        let original = root.directory().join("user.mzML");
        fs::write(&original, b"user bytes").expect("user file");
        let directory = AttemptDirectory::create(root.directory()).expect("made");
        let path = directory.path.clone();
        fs::hard_link(&original, path.join(LINK_NAME)).expect("link");
        fs::write(path.join("request.json"), b"{}").expect("scratch");
        drop(directory);

        assert_eq!(fs::read(path.join(LINK_NAME)).expect("kept"), b"user bytes");
        assert!(path.join(MARKER).is_file(), "the marker stays with it");
        assert!(!path.join("request.json").exists(), "the rest is removed");
        assert_eq!(sweep(root.directory()).live, 1, "this session's own");
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
