//! The view cache library against real directories under the system temporary
//! folder, never the application data folders. Two `ViewCache` values over one
//! root stand in for two processes: Windows applies sharing to handles, not to
//! processes, so a pin held by one is refused to the other exactly as it would
//! be across processes. A true second process is native QA (decision 14).

use std::fs;
use std::os::windows::fs::OpenOptionsExt as _;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Barrier};
use std::time::{Duration, SystemTime};

use super::*;
use crate::project::tests::Scratch;

const INTENT: &str = "mzml+no_additional_centroiding+all+mz64_intensity32+zlib";
/// An id no process can have: Windows process ids are multiples of four.
const NOBODY: u32 = 0xFFFF_FFFD;

fn key(source: u8) -> CacheKey {
    CacheKey::new(
        Sha256Digest::from_bytes([source; 32]),
        Sha256Digest::from_bytes([0xAA; 32]),
        INTENT,
    )
    .expect("a key")
}

fn parent(scratch: &Scratch) -> PathBuf {
    scratch.join("local")
}

fn cache(scratch: &Scratch) -> ViewCache {
    ViewCache::open(Some(&parent(scratch))).expect("the cache opens")
}

fn capped(scratch: &Scratch, cap_bytes: u64) -> ViewCache {
    ViewCache::open_with_cap(Some(&parent(scratch)), cap_bytes).expect("the cache opens")
}

fn facts(bytes: &[u8]) -> StagedFacts {
    StagedFacts {
        source_byte_length: 2_086_041,
        provider_release: "3.0.26013".to_owned(),
        output_sha256: Sha256Digest::calculate(bytes).expect("SHA-256"),
        output_byte_length: bytes.len() as u64,
    }
}

/// Stages `bytes` as a validated output and publishes it under `key`.
fn store(cache: &ViewCache, key: &CacheKey, bytes: &[u8]) -> Result<Stored, StoreFailure> {
    let attempt = cache.begin_attempt().expect("an attempt");
    fs::write(attempt.staged_output(), bytes).expect("stage the output");
    cache.publish(attempt, key, &facts(bytes))
}

fn published(cache: &ViewCache, key: &CacheKey, bytes: &[u8]) {
    assert!(matches!(store(cache, key, bytes), Ok(Stored::Published)));
}

fn hit(cache: &ViewCache, key: &CacheKey) -> Box<VerifiedEntry> {
    match cache.verify(key) {
        Lookup::Hit(entry) => entry,
        other => panic!("expected a hit, found {other:?}"),
    }
}

fn entry(cache: &ViewCache, key: &CacheKey) -> PathBuf {
    cache.entries().join(key.name())
}

/// Sets an entry's last-opened time to a fixed instant.
fn age(cache: &ViewCache, key: &CacheKey, seconds: u64) {
    let time = SystemTime::UNIX_EPOCH + Duration::from_secs(1_700_000_000 + seconds);
    assert!(set_directory_time(&entry(cache, key), time));
}

fn names(directory: &Path) -> Vec<String> {
    let mut names: Vec<String> = fs::read_dir(directory)
        .expect("list the directory")
        .map(|child| {
            child
                .expect("an entry")
                .file_name()
                .into_string()
                .expect("UTF-8")
        })
        .collect();
    names.sort();
    names
}

/// Every name below `directory` and its bytes, without following a link, so
/// a test can show that nothing there changed.
fn snapshot(directory: &Path) -> Vec<(PathBuf, Option<Vec<u8>>)> {
    let mut found = Vec::new();
    for name in names(directory) {
        let path = directory.join(&name);
        let metadata = fs::symlink_metadata(&path).expect("metadata");
        if plain_directory(&metadata) {
            found.push((path.clone(), None));
            found.extend(snapshot(&path));
        } else if local_document::is_reparse_point(&metadata) {
            found.push((path, None));
        } else {
            found.push((path.clone(), Some(fs::read(&path).expect("read"))));
        }
    }
    found
}

fn junction(link: &Path, target: &Path) {
    let made = Command::new("cmd")
        .args(["/D", "/C", "mklink", "/J"])
        .arg(link)
        .arg(target)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .expect("cmd runs");
    assert!(made.success(), "mklink /J {}", link.display());
}

/// A directory symbolic link, where this account may create one. Without the
/// privilege (error 1314) that half of a test is skipped, and says so; the
/// junction half never is. Under CI the link is required: libtest hides a
/// passing test's output, so a skip there would pass unseen.
fn symlink(link: &Path, target: &Path) -> bool {
    match std::os::windows::fs::symlink_dir(target, link) {
        Ok(()) => true,
        Err(error) if error.raw_os_error() == Some(1314) && std::env::var_os("CI").is_none() => {
            eprintln!("note: no symbolic-link privilege; the symlink case is skipped");
            false
        }
        Err(error) => panic!("symlink {}: {error}", link.display()),
    }
}

fn is_link(path: &Path) -> bool {
    fs::symlink_metadata(path).is_ok_and(|metadata| local_document::is_reparse_point(&metadata))
}

/// Outside the cache: what a link points at. It holds what a careless removal
/// would take for cache content -- an entry's files, a key-named entry and an
/// attempt marker naming `attempt` with a gone owner -- and a sentinel.
fn outside(scratch: &Scratch, label: &str, attempt: &str) -> PathBuf {
    let directory = scratch.join(label);
    let entry = directory.join(key(9).name());
    fs::create_dir_all(&entry).expect("outside");
    for place in [&directory, &entry] {
        fs::write(place.join(OUTPUT), b"not the cache's").expect("decoy");
        fs::write(place.join(MANIFEST), b"{}").expect("decoy");
    }
    fs::write(directory.join("sentinel.txt"), b"keep me").expect("sentinel");
    write_owner(&directory, attempt, NOBODY, 1);
    directory
}

fn write_owner(directory: &Path, attempt: &str, process: u32, created: u64) {
    let marker = AttemptOwner {
        schema: ATTEMPT_SCHEMA.to_owned(),
        attempt_id: attempt.to_owned(),
        owner_process_id: process,
        owner_process_created: created,
    };
    fs::write(
        directory.join(ATTEMPT_OWNER),
        serde_json::to_vec(&marker).expect("JSON"),
    )
    .expect("marker");
}

/// An attempt a process that is gone left mid-conversion.
fn abandoned(cache: &ViewCache) -> PathBuf {
    let name = uuid::Uuid::new_v4().to_string();
    let path = cache.staging().join(&name);
    let partial = path.join("conversion").join("output");
    fs::create_dir_all(&partial).expect("staging");
    fs::create_dir(path.join(ATTEMPT_ENTRY)).expect("staging");
    write_owner(&path, &name, NOBODY, 1);
    fs::write(partial.join("QC_pool_01.mzML.tmp"), b"<mzML").expect("partial");
    path
}

// ---------------------------------------------------------------------------
// The key
// ---------------------------------------------------------------------------

#[test]
fn the_key_is_the_sha256_of_four_fixed_lines_and_each_input_changes_it() {
    let source = Sha256Digest::from_bytes([0x11; 32]);
    let provider = Sha256Digest::from_bytes([0x22; 32]);
    let golden = CacheKey::new(source, provider, INTENT).expect("a key");
    // Computed outside this code, with Python's hashlib over
    // "mscanvas-view-cache-key/1\nsource-sha256=11..11\nprovider-sha256=22..22\nintent=<INTENT>\n".
    assert_eq!(
        golden.name(),
        "580dd9813139544259c9f5a85bb5287c8341fe099129cf6d07b663bcba84711f"
    );
    let others = [
        CacheKey::new(Sha256Digest::from_bytes([0x12; 32]), provider, INTENT),
        CacheKey::new(source, Sha256Digest::from_bytes([0x23; 32]), INTENT),
        CacheKey::new(
            source,
            provider,
            "mzml+no_additional_centroiding+all+mz64_intensity64+zlib",
        ),
    ];
    for other in others {
        assert_ne!(other.expect("a key").name(), golden.name());
    }
}

#[test]
fn an_intent_that_is_not_one_bounded_line_makes_no_key() {
    let digest = Sha256Digest::from_bytes([1; 32]);
    let forged = format!("{INTENT}\nprovider-sha256={}", "00".repeat(32));
    let long = "x".repeat(MAX_TEXT_BYTES + 1);
    for intent in ["", "a\nb", "a\rb", "a\tb", forged.as_str(), long.as_str()] {
        assert!(
            CacheKey::new(digest, digest, intent).is_none(),
            "{intent:?}"
        );
    }
    assert!(CacheKey::new(digest, digest, &"x".repeat(MAX_TEXT_BYTES)).is_some());
}

#[test]
fn a_digest_counts_only_as_this_cache_spells_one() {
    let lower = "ab".repeat(32);
    assert!(parse_hex(&lower).is_some());
    assert!(parse_hex(&lower.to_uppercase()).is_none());
    assert!(parse_hex(&"ab".repeat(31)).is_none());
    assert!(parse_hex(&format!("{}zz", "ab".repeat(31))).is_none());
}

// ---------------------------------------------------------------------------
// The root
// ---------------------------------------------------------------------------

#[test]
fn the_root_is_made_whole_with_its_marker_and_nothing_is_left_beside_it() {
    let scratch = Scratch::new("vc-root");
    // The parent does not exist yet, as on a first run.
    let cache = cache(&scratch);
    let root = parent(&scratch).join(ROOT_NAME);
    assert_eq!(
        fs::read(root.join(ROOT_MARKER)).expect("marker"),
        b"mscanvas-view-cache\n"
    );
    assert_eq!(names(&parent(&scratch)), [ROOT_NAME]);
    assert_eq!(names(&root), [ROOT_MARKER, ENTRIES, STAGING]);

    // A second handle on the same root, as a second process would have.
    let second = ViewCache::open(Some(&parent(&scratch))).expect("opens again");
    drop((cache, second));
    assert_eq!(names(&parent(&scratch)), [ROOT_NAME]);
}

#[test]
fn losing_the_race_to_make_the_root_removes_only_the_losers_creation_directory() {
    let scratch = Scratch::new("vc-root-race");
    let cache = cache(&scratch);
    published(&cache, &key(1), b"entry");
    let before = snapshot(&cache.root);

    // A second maker that found no root a moment ago: its rename meets this one.
    assert_eq!(
        make_root(&parent(&scratch), &cache.root, rename_no_replace),
        Ok(())
    );
    assert_eq!(names(&parent(&scratch)), [ROOT_NAME]);
    assert_eq!(snapshot(&cache.root), before);
}

#[test]
fn makers_racing_on_threads_leave_one_root_and_no_creation_directory() {
    let scratch = Scratch::new("vc-root-threads");
    let parent = parent(&scratch);
    let barrier = Arc::new(Barrier::new(8));
    let makers: Vec<_> = (0..8)
        .map(|_| {
            let (parent, barrier) = (parent.clone(), Arc::clone(&barrier));
            std::thread::spawn(move || {
                barrier.wait();
                ViewCache::open(Some(&parent)).map(drop)
            })
        })
        .collect();
    for maker in makers {
        // A maker may meet another's rename handle still open, which is a
        // transient `Unavailable`; it never finds the root unrecognized.
        assert_ne!(
            maker.join().expect("the thread"),
            Err(RootRefusal::Unrecognized)
        );
    }
    assert_eq!(names(&parent), [ROOT_NAME]);
    assert_eq!(
        fs::read(parent.join(ROOT_NAME).join(ROOT_MARKER)).expect("marker"),
        ROOT_MARKER_CONTENT
    );
}

#[test]
fn a_rename_that_fails_otherwise_refuses_and_leaves_no_creation_directory() {
    let scratch = Scratch::new("vc-root-fail");
    let parent = parent(&scratch);
    let refused = make_root(&parent, &parent.join(ROOT_NAME), |_, _| {
        Err(io::ErrorKind::PermissionDenied.into())
    });
    assert_eq!(refused, Err(RootRefusal::Unavailable));
    assert!(names(&parent).is_empty());
}

#[test]
fn a_crash_before_the_rename_never_blocks_the_root_and_is_left_in_place() {
    let scratch = Scratch::new("vc-root-crash");
    let leftover = parent(&scratch).join(format!("{ROOT_NAME}.creating-{}", uuid::Uuid::new_v4()));
    fs::create_dir_all(&leftover).expect("a creation directory");
    fs::write(leftover.join(ROOT_MARKER), ROOT_MARKER_CONTENT).expect("its marker");

    let cache = cache(&scratch);
    let _ = (cache.clear(), cache.sweep_staging());
    assert_eq!(names(&leftover), [ROOT_MARKER]);
    assert_eq!(names(&parent(&scratch)).len(), 2);
}

#[test]
fn a_root_mscanvas_did_not_make_is_refused_and_untouched() {
    let scratch = Scratch::new("vc-root-foreign");
    let elsewhere = outside(&scratch, "outside", "unused");
    let elsewhere_before = snapshot(&elsewhere);
    let parent = parent(&scratch);
    let root = parent.join(ROOT_NAME);

    let cases: [(&str, &dyn Fn()); 5] = [
        ("no marker", &|| {
            fs::create_dir_all(&root).expect("root");
            fs::write(root.join("notes.txt"), b"theirs").expect("a file");
        }),
        ("another marker", &|| {
            fs::create_dir_all(&root).expect("root");
            fs::write(root.join(ROOT_MARKER), b"something-else\n").expect("marker");
        }),
        ("a marker that is a directory", &|| {
            fs::create_dir_all(root.join(ROOT_MARKER)).expect("marker");
        }),
        ("a file", &|| {
            fs::create_dir_all(&parent).expect("parent");
            fs::write(&root, b"theirs").expect("a file");
        }),
        ("a junction", &|| {
            fs::create_dir_all(&parent).expect("parent");
            junction(&root, &elsewhere);
        }),
    ];
    for (case, plant) in cases {
        plant();
        let before = snapshot(&parent);
        assert_eq!(
            ViewCache::open(Some(&parent)).err(),
            Some(RootRefusal::Unrecognized),
            "{case}"
        );
        assert_eq!(snapshot(&parent), before, "{case}");
        // Remove what the case planted, the link as a link.
        if is_link(&root) {
            fs::remove_dir(&root).expect("unlink");
        } else if root.is_file() {
            fs::remove_file(&root).expect("remove");
        } else {
            fs::remove_dir_all(&root).expect("remove");
        }
    }
    assert_eq!(snapshot(&elsewhere), elsewhere_before);

    // `entries` that is a link, under a root that is MSCanvas's.
    drop(ViewCache::open(Some(&parent)).expect("a real root"));
    fs::remove_dir(root.join(ENTRIES)).expect("empty entries");
    junction(&root.join(ENTRIES), &elsewhere);
    assert_eq!(
        ViewCache::open(Some(&parent)).err(),
        Some(RootRefusal::Unrecognized)
    );
    assert!(is_link(&root.join(ENTRIES)));
    assert_eq!(snapshot(&elsewhere), elsewhere_before);
}

#[test]
fn no_folder_or_one_that_cannot_be_made_is_unavailable() {
    assert_eq!(ViewCache::open(None).err(), Some(RootRefusal::Unavailable));
    let scratch = Scratch::new("vc-root-none");
    let file = scratch.write("local", b"a file where the folder goes");
    assert_eq!(
        ViewCache::open(Some(&file)).err(),
        Some(RootRefusal::Unavailable)
    );
    assert_eq!(
        fs::read(&file).expect("kept"),
        b"a file where the folder goes"
    );
}

// ---------------------------------------------------------------------------
// Publishing and verification
// ---------------------------------------------------------------------------

#[test]
fn the_rename_refuses_an_existing_name_and_replaces_nothing() {
    let scratch = Scratch::new("vc-rename");
    let from = scratch.join("from");
    fs::create_dir(&from).expect("source");
    fs::write(from.join("a"), b"new").expect("file");
    // An empty directory, which a POSIX-semantics rename would replace.
    let to_directory = scratch.join("to");
    fs::create_dir(&to_directory).expect("target");
    let to_file = scratch.write("file", b"old");

    for target in [&to_directory, &to_file] {
        let error = rename_no_replace(&from, target).expect_err("refused");
        assert_eq!(error.kind(), io::ErrorKind::AlreadyExists, "{error:?}");
        // ERROR_ALREADY_EXISTS: the code the publish reads as "exists".
        assert_eq!(error.raw_os_error(), Some(183), "{error:?}");
    }
    assert!(names(&to_directory).is_empty());
    assert_eq!(fs::read(&to_file).expect("kept"), b"old");
    assert_eq!(fs::read(from.join("a")).expect("kept"), b"new");
}

#[test]
fn a_published_entry_is_verified_and_pinned_and_its_attempt_is_gone() {
    let scratch = Scratch::new("vc-publish");
    let cache = cache(&scratch);
    let key = key(1);
    let bytes = b"<mzML> converted </mzML>";
    published(&cache, &key, bytes);

    assert_eq!(names(&entry(&cache, &key)), [MANIFEST, OUTPUT]);
    assert!(names(&cache.staging()).is_empty(), "the attempt is removed");
    let entry_hit = hit(&cache, &key);
    let manifest = entry_hit.manifest();
    assert_eq!(
        (
            manifest.schema_version,
            manifest.key.as_str(),
            manifest.source_sha256.as_str(),
            manifest.source_byte_length,
            manifest.source_kind.as_str(),
            manifest.provider_release.as_str(),
            manifest.provider_sha256.as_str(),
            manifest.intent.as_str(),
            manifest.output_byte_length,
        ),
        (
            1,
            key.name(),
            "01".repeat(32).as_str(),
            2_086_041,
            "thermoRaw",
            "3.0.26013",
            "aa".repeat(32).as_str(),
            INTENT,
            bytes.len() as u64,
        )
    );
    assert_eq!(
        Some(manifest.output_sha256.as_str()),
        Some(hex(&Sha256Digest::calculate(bytes).expect("SHA-256")).as_str())
    );
    assert!(manifest.created_at.ends_with('Z'));
    // A reader that shares read access still opens the pinned file.
    assert_eq!(fs::read(entry_hit.output()).expect("readable"), bytes);
    // No path and no file name is written down.
    let text = fs::read_to_string(entry(&cache, &key).join(MANIFEST)).expect("manifest");
    assert!(!text.contains('\\') && !text.contains("local"), "{text}");
}

#[test]
fn a_second_publish_of_a_key_uses_the_first_entry_and_rewrites_nothing() {
    let scratch = Scratch::new("vc-publish-twice");
    let (first, second) = (cache(&scratch), cache(&scratch));
    let key = key(1);
    published(&first, &key, b"first copy");
    age(&first, &key, 0);
    let before = snapshot(&first.root);
    let times: Vec<_> = [MANIFEST, OUTPUT]
        .map(|name| {
            fs::metadata(entry(&first, &key).join(name))
                .and_then(|metadata| metadata.modified())
                .expect("time")
        })
        .into();

    // The same key from another handle, with other bytes: the entry in place
    // wins and its copy is discarded.
    match store(&second, &key, b"second copy") {
        Ok(Stored::Existing(existing)) => {
            assert_eq!(fs::read(existing.output()).expect("read"), b"first copy");
        }
        other => panic!("expected the existing entry, found {other:?}"),
    }
    assert_eq!(
        snapshot(&first.root),
        before,
        "nothing in the entry changed"
    );
    let after: Vec<_> = [MANIFEST, OUTPUT]
        .map(|name| {
            fs::metadata(entry(&first, &key).join(name))
                .and_then(|metadata| metadata.modified())
                .expect("time")
        })
        .into();
    assert_eq!(after, times);
    assert!(names(&first.staging()).is_empty());
}

#[test]
fn every_damaged_entry_is_never_opened_and_is_removed_when_its_names_are_mscanvass() {
    let scratch = Scratch::new("vc-damage");
    let cache = cache(&scratch);
    let bytes = b"0123456789";
    let manifest_of = |key: &CacheKey| entry(&cache, key).join(MANIFEST);
    let output_of = |key: &CacheKey| entry(&cache, key).join(OUTPUT);
    let rewrite = |key: &CacheKey, edit: &dyn Fn(&mut serde_json::Value)| {
        let mut value: serde_json::Value =
            serde_json::from_slice(&fs::read(manifest_of(key)).expect("read")).expect("JSON");
        edit(&mut value);
        fs::write(manifest_of(key), serde_json::to_vec(&value).expect("JSON")).expect("write");
    };
    let other_manifest = {
        published(&cache, &key(200), bytes);
        fs::read(manifest_of(&key(200))).expect("read")
    };
    type Damage<'a> = Box<dyn Fn(&CacheKey) + 'a>;
    let damages: Vec<(&str, Damage<'_>)> = vec![
        (
            "another digest",
            Box::new(|key: &CacheKey| fs::write(output_of(key), b"9876543210").expect("w")),
        ),
        (
            "another length",
            Box::new(|key: &CacheKey| fs::write(output_of(key), b"01234567890").expect("w")),
        ),
        (
            "no view.mzML",
            Box::new(|key: &CacheKey| fs::remove_file(output_of(key)).expect("rm")),
        ),
        (
            "no entry.json",
            Box::new(|key: &CacheKey| fs::remove_file(manifest_of(key)).expect("rm")),
        ),
        (
            "neither file",
            Box::new(|key: &CacheKey| {
                fs::remove_file(output_of(key)).expect("rm");
                fs::remove_file(manifest_of(key)).expect("rm");
            }),
        ),
        (
            "not JSON",
            Box::new(|key: &CacheKey| fs::write(manifest_of(key), b"not json").expect("w")),
        ),
        (
            "over 16 KiB",
            Box::new(|key: &CacheKey| {
                let mut text = fs::read(manifest_of(key)).expect("read");
                text.resize(17 * 1024, b' ');
                fs::write(manifest_of(key), text).expect("w");
            }),
        ),
        (
            "an unknown field",
            Box::new(|key: &CacheKey| {
                rewrite(key, &|value: &mut serde_json::Value| {
                    value["path"] = "C:\\data".into();
                })
            }),
        ),
        (
            "another schema",
            Box::new(|key: &CacheKey| {
                rewrite(key, &|value: &mut serde_json::Value| {
                    value["schemaVersion"] = 2.into();
                })
            }),
        ),
        (
            "another source kind",
            Box::new(|key: &CacheKey| {
                rewrite(key, &|value: &mut serde_json::Value| {
                    value["sourceKind"] = "sciexWiff".into();
                })
            }),
        ),
        (
            "an uppercase digest",
            Box::new(|key: &CacheKey| {
                rewrite(key, &|value: &mut serde_json::Value| {
                    let upper = value["outputSha256"]
                        .as_str()
                        .expect("digest")
                        .to_uppercase();
                    value["outputSha256"] = upper.into();
                })
            }),
        ),
        (
            "another key's manifest",
            Box::new(|key: &CacheKey| {
                fs::write(manifest_of(key), &other_manifest).expect("w");
            }),
        ),
        (
            "a line break in the release",
            Box::new(|key: &CacheKey| {
                rewrite(key, &|value: &mut serde_json::Value| {
                    value["providerRelease"] = "3.0\n1".into();
                })
            }),
        ),
    ];
    for (index, (damage, apply)) in damages.iter().enumerate() {
        let key = key(u8::try_from(index).expect("few cases"));
        published(&cache, &key, bytes);
        apply(&key);
        assert!(
            matches!(cache.verify(&key), Lookup::Damaged { removed: true }),
            "{damage}"
        );
        assert!(!entry(&cache, &key).exists(), "{damage}");
        assert!(matches!(cache.verify(&key), Lookup::Miss), "{damage}");
    }
}

#[test]
fn an_entry_with_anything_else_in_it_is_unrecognized_and_left_as_found() {
    let scratch = Scratch::new("vc-unrecognized");
    let cache = cache(&scratch);
    let elsewhere = outside(&scratch, "outside", "unused");
    let elsewhere_before = snapshot(&elsewhere);

    let extra = key(1);
    published(&cache, &extra, b"bytes");
    fs::write(entry(&cache, &extra).join("notes.txt"), b"theirs").expect("extra");

    let directory_at_a_name = key(2);
    published(&cache, &directory_at_a_name, b"bytes");
    fs::remove_file(entry(&cache, &directory_at_a_name).join(OUTPUT)).expect("rm");
    fs::create_dir(entry(&cache, &directory_at_a_name).join(OUTPUT)).expect("dir");

    let link_inside = key(3);
    published(&cache, &link_inside, b"bytes");
    junction(&entry(&cache, &link_inside).join("link"), &elsewhere);

    let link_in_place = key(4);
    junction(&entry(&cache, &link_in_place), &elsewhere);

    let before = snapshot(&cache.root);
    for key in [&extra, &directory_at_a_name, &link_inside, &link_in_place] {
        assert!(matches!(cache.verify(key), Lookup::Unrecognized));
    }
    // A publish into a place something else holds stores nothing.
    assert_eq!(
        store(&cache, &link_in_place, b"bytes").err(),
        Some(StoreFailure::EntryUnrecognized)
    );
    assert!(names(&cache.staging()).is_empty());
    assert_eq!(snapshot(&cache.root), before);
    assert_eq!(snapshot(&elsewhere), elsewhere_before);
}

#[test]
fn a_damaged_entry_in_the_way_of_a_publish_is_removed_and_the_publish_goes_through() {
    let scratch = Scratch::new("vc-publish-damaged");
    let cache = cache(&scratch);
    let key = key(1);
    published(&cache, &key, b"first copy");
    fs::write(entry(&cache, &key).join(OUTPUT), b"FIRST COPY").expect("damage");

    published(&cache, &key, b"second copy");
    assert_eq!(
        fs::read(hit(&cache, &key).output()).expect("read"),
        b"second copy"
    );
}

#[test]
fn a_rename_that_fails_otherwise_stores_nothing() {
    let scratch = Scratch::new("vc-publish-fail");
    let cache = cache(&scratch);
    let key = key(1);
    let bytes = b"bytes";

    // Through the seam: nothing is published and the attempt is removed.
    let attempt = cache.begin_attempt().expect("an attempt");
    fs::write(attempt.staged_output(), bytes).expect("stage");
    let refused = cache.publish_with(attempt, &key, &facts(bytes), |_, _| {
        Err(io::ErrorKind::PermissionDenied.into())
    });
    assert_eq!(refused.err(), Some(StoreFailure::NotStored));
    assert!(names(&cache.entries()).is_empty());
    assert!(names(&cache.staging()).is_empty());

    // For real: a scanner holding the staged entry without delete sharing.
    let attempt = cache.begin_attempt().expect("an attempt");
    fs::write(attempt.staged_output(), bytes).expect("stage");
    let attempt_path = attempt.path().to_owned();
    let scanner = open_directory(&attempt_path.join(ATTEMPT_ENTRY), 0, SHARE_READ).expect("held");
    assert_eq!(
        cache.publish(attempt, &key, &facts(bytes)).err(),
        Some(StoreFailure::NotStored)
    );
    drop(scanner);
    assert!(names(&cache.entries()).is_empty());
    // What the scanner kept from being removed keeps its marker, and a sweep
    // in this session leaves it: its owner is this process.
    assert!(attempt_path.join(ATTEMPT_OWNER).is_file());
    assert_eq!(cache.sweep_staging().live, 1);
}

#[test]
fn an_entry_over_the_ceiling_or_alone_over_the_cap_is_refused_before_any_eviction() {
    let scratch = Scratch::new("vc-too-large");
    let cache = capped(&scratch, 100);
    published(&cache, &key(1), &[1; 40]);
    published(&cache, &key(2), &[2; 40]);
    let before = snapshot(&cache.root);

    assert_eq!(
        store(&cache, &key(3), &[3; 101]).err(),
        Some(StoreFailure::EntryTooLarge)
    );
    assert_eq!(
        snapshot(&cache.root),
        before,
        "nothing evicted, nothing staged"
    );

    let uncapped = ViewCache::open(Some(&parent(&scratch))).expect("opens");
    let attempt = uncapped.begin_attempt().expect("an attempt");
    let over = StagedFacts {
        output_byte_length: MAX_ENTRY_BYTES + 1,
        ..facts(b"")
    };
    assert_eq!(
        uncapped.publish(attempt, &key(3), &over).err(),
        Some(StoreFailure::EntryTooLarge)
    );
    assert_eq!(snapshot(&cache.root), before);
}

#[test]
fn a_dropped_attempt_takes_everything_it_staged_with_it() {
    let scratch = Scratch::new("vc-attempt-drop");
    let cache = cache(&scratch);
    let attempt = cache.begin_attempt().expect("an attempt");
    let partial = attempt.path().join("conversion").join("output");
    fs::create_dir_all(&partial).expect("staging");
    fs::write(partial.join("QC_pool_01.mzML.tmp"), b"<mzML").expect("partial");
    fs::write(attempt.staged_output(), b"<mzML/>").expect("staged");
    drop(attempt);
    assert!(names(&cache.staging()).is_empty());
}

// ---------------------------------------------------------------------------
// Pins, eviction and Clear
// ---------------------------------------------------------------------------

#[test]
fn a_pinned_entry_is_never_evicted_or_cleared_from_any_handle_on_the_root() {
    let scratch = Scratch::new("vc-pin");
    let (owner_handle, other_handle) = (cache(&scratch), cache(&scratch));
    let (pinned, loose) = (key(1), key(2));
    published(&owner_handle, &pinned, b"viewed");
    published(&owner_handle, &loose, b"loose!");

    let pin = hit(&owner_handle, &pinned);
    // A second reader pins it too: read sharing admits it.
    let second_pin = hit(&other_handle, &pinned);
    assert_eq!(
        other_handle.evict(u64::MAX),
        Removal {
            removed: 1,
            freed_bytes: 6,
            kept_in_use: 1,
            ..Removal::default()
        }
    );
    assert_eq!(
        other_handle.clear(),
        Removal {
            kept_in_use: 1,
            ..Removal::default()
        }
    );
    assert_eq!(fs::read(pin.output()).expect("intact"), b"viewed");

    drop(pin);
    assert_eq!(
        other_handle.clear().kept_in_use,
        1,
        "one pin still holds it"
    );
    drop(second_pin);
    assert_eq!(
        other_handle.clear(),
        Removal {
            removed: 1,
            freed_bytes: 6,
            ..Removal::default()
        }
    );
    assert!(names(&owner_handle.entries()).is_empty());
}

#[test]
fn eviction_takes_the_least_recently_opened_entry_first_then_the_key() {
    let scratch = Scratch::new("vc-evict-order");
    let cache = cache(&scratch);
    let (old, tied_a, tied_b) = (key(1), key(2), key(3));
    for key in [&old, &tied_a, &tied_b] {
        published(&cache, key, &[7; 10]);
    }
    age(&cache, &old, 100);
    age(&cache, &tied_a, 200);
    age(&cache, &tied_b, 200);
    let (first_tied, second_tied) = if tied_a.name() < tied_b.name() {
        (&tied_a, &tied_b)
    } else {
        (&tied_b, &tied_a)
    };

    // Opening the oldest moves it to the back.
    assert!(hit(&cache, &old).mark_opened());
    for expected in [first_tied, second_tied, &old] {
        assert_eq!(cache.evict(1).removed, 1);
        assert!(!entry(&cache, expected).exists(), "{}", expected.name());
    }
    assert_eq!(cache.evict(1), Removal::default());
}

#[test]
fn publishing_evicts_to_the_cap_and_pinned_entries_alone_may_keep_it_above() {
    let scratch = Scratch::new("vc-evict-cap");
    let cache = capped(&scratch, 30);
    for (index, key) in [key(1), key(2), key(3)].iter().enumerate() {
        published(&cache, key, &[1; 10]);
        age(&cache, key, index as u64);
    }
    published(&cache, &key(4), &[4; 10]);
    assert!(!entry(&cache, &key(1)).exists(), "the oldest went");
    assert_eq!(
        cache.usage(),
        Usage {
            entries: 3,
            bytes: 30,
            unrecognized: 0
        }
    );

    let pins: Vec<_> = [key(2), key(3), key(4)]
        .iter()
        .map(|key| hit(&cache, key))
        .collect();
    published(&cache, &key(5), &[5; 10]);
    assert_eq!(
        cache.usage().bytes,
        40,
        "above the cap by pinned entries only"
    );
    drop(pins);
    published(&cache, &key(6), &[6; 10]);
    assert_eq!(cache.usage().bytes, 30);
}

// ---------------------------------------------------------------------------
// The staging sweep
// ---------------------------------------------------------------------------

#[test]
fn the_sweep_removes_only_attempts_whose_owner_is_gone() {
    let scratch = Scratch::new("vc-sweep");
    let cache = cache(&scratch);
    let staging = cache.staging();
    let (id, created) = this_process().expect("this process");

    let gone = abandoned(&cache);
    let reused = abandoned(&cache);
    write_owner(
        &reused,
        reused
            .file_name()
            .and_then(|name| name.to_str())
            .expect("name"),
        id,
        created.wrapping_sub(1),
    );
    let mine = cache.begin_attempt().expect("this process's attempt");

    // What is not provably an attempt, however much it looks like one.
    let no_marker = staging.join(uuid::Uuid::new_v4().to_string());
    fs::create_dir(&no_marker).expect("dir");
    let other_name = abandoned(&cache);
    write_owner(&other_name, &uuid::Uuid::new_v4().to_string(), NOBODY, 1);
    let other_schema = abandoned(&cache);
    fs::write(
        other_schema.join(ATTEMPT_OWNER),
        fs::read_to_string(other_schema.join(ATTEMPT_OWNER))
            .expect("marker")
            .replace(ATTEMPT_SCHEMA, "mscanvas.viewCache.attempt/2"),
    )
    .expect("marker");
    let upper = abandoned(&cache);
    let upper_name = staging.join(
        upper
            .file_name()
            .and_then(|name| name.to_str())
            .expect("name")
            .to_ascii_uppercase(),
    );
    fs::rename(&upper, &upper_name).expect("rename");
    let not_uuid = staging.join("results");
    fs::create_dir(&not_uuid).expect("dir");
    let loose = staging.join("notes.txt");
    fs::write(&loose, b"theirs").expect("file");
    let left = [
        &no_marker,
        &other_name,
        &other_schema,
        &upper_name,
        &not_uuid,
        &loose,
    ];
    let left_before: Vec<_> = left
        .iter()
        .map(|path| (path.to_path_buf(), fs::metadata(path).is_ok()))
        .collect();

    assert_eq!(
        cache.sweep_staging(),
        Sweep {
            removed: 2,
            live: 1,
            unrecognized: 6,
            ..Sweep::default()
        }
    );
    assert!(!gone.exists() && !reused.exists());
    assert!(
        mine.path().join(ATTEMPT_OWNER).is_file(),
        "a live attempt is whole"
    );
    for (path, existed) in left_before {
        assert_eq!(path.exists(), existed, "{}", path.display());
    }
}

#[test]
fn an_attempt_removal_that_cannot_finish_keeps_its_marker_for_the_next_sweep() {
    let scratch = Scratch::new("vc-sweep-held");
    let cache = cache(&scratch);
    let gone = abandoned(&cache);
    let held_file = gone
        .join("conversion")
        .join("output")
        .join("QC_pool_01.mzML.tmp");
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(SHARE_READ)
        .open(&held_file)
        .expect("hold a staged file");

    assert_eq!(
        cache.sweep_staging(),
        Sweep {
            failed: 1,
            ..Sweep::default()
        }
    );
    assert!(gone.join(ATTEMPT_OWNER).is_file(), "the marker stays");

    drop(held);
    assert_eq!(cache.sweep_staging().removed, 1);
    assert!(!gone.exists());
}

// ---------------------------------------------------------------------------
// Links and foreign names
// ---------------------------------------------------------------------------

/// The deletion-safety proof: a junction, and a symbolic link where one can be
/// made, planted wherever the cache looks, each pointing outside it at a
/// directory that holds what a careless removal would take for cache content.
/// Eviction, Clear and the sweep leave every target exactly as it was and every
/// link where it is, a gone owner's attempt holding one included.
#[test]
fn links_planted_in_the_cache_are_never_followed_by_eviction_clear_or_the_sweep() {
    let scratch = Scratch::new("vc-links");
    let cache = cache(&scratch);
    let link_attempt = uuid::Uuid::new_v4().to_string();
    let symlink_attempt = uuid::Uuid::new_v4().to_string();
    let elsewhere = outside(&scratch, "outside", &link_attempt);
    let symlinked = outside(&scratch, "outside-symlinked", &symlink_attempt);
    let before = (snapshot(&elsewhere), snapshot(&symlinked));

    // Real entries beside the links, so there is something to remove.
    published(&cache, &key(1), b"evictable");
    let pinned = key(2);
    published(&cache, &pinned, b"pinned");
    let pin = hit(&cache, &pinned);

    let mut kept_links = vec![
        cache.entries().join(key(3).name()),
        cache.entries().join("loose-link"),
        cache.staging().join(&link_attempt),
        cache.root.join("foreign-link"),
    ];
    for link in &kept_links {
        junction(link, &elsewhere);
    }
    let link_inside_an_entry = key(4);
    published(&cache, &link_inside_an_entry, b"with a link");
    junction(
        &entry(&cache, &link_inside_an_entry).join("link"),
        &elsewhere,
    );
    kept_links.push(entry(&cache, &link_inside_an_entry).join("link"));
    // Counted: the key-named and loose links under `entries`, and the
    // attempt-named link under `staging`. The root's own is never listed.
    let mut planted = 3;
    for link in [
        cache.entries().join(key(5).name()),
        cache.staging().join(&symlink_attempt),
    ] {
        if symlink(&link, &symlinked) {
            kept_links.push(link);
            planted += 1;
        }
    }
    let gone = abandoned(&cache);
    kept_links.push(gone.join("conversion").join("link"));
    junction(&gone.join("conversion").join("link"), &elsewhere);
    if symlink(&gone.join("symlink"), &symlinked) {
        kept_links.push(gone.join("symlink"));
    }

    assert!(matches!(cache.verify(&key(3)), Lookup::Unrecognized));
    let evicted = cache.evict(u64::MAX);
    assert_eq!(
        (evicted.removed, evicted.kept_in_use),
        (1, 1),
        "{evicted:?}"
    );
    let swept = cache.sweep_staging();
    // The gone owner's attempt holds links, so it is left whole.
    assert_eq!((swept.removed, swept.linked), (0, 1), "{swept:?}");
    assert!(gone.join(ATTEMPT_OWNER).is_file(), "its marker stays");
    let cleared = cache.clear();
    // The planted links, the entry holding a link, and the attempt holding
    // links.
    assert_eq!(cleared.unrecognized_left, planted + 2, "{cleared:?}");
    assert_eq!(cleared.kept_in_use, 1);

    for link in &kept_links {
        assert!(is_link(link), "{} is still there", link.display());
    }
    assert_eq!((snapshot(&elsewhere), snapshot(&symlinked)), before);
    assert_eq!(fs::read(pin.output()).expect("pinned"), b"pinned");
}

#[test]
fn foreign_names_are_left_where_they_are_and_counted() {
    let scratch = Scratch::new("vc-foreign");
    let cache = cache(&scratch);
    published(&cache, &key(1), b"ours");
    let foreign = [
        cache.root.join("notes.txt"),
        cache.entries().join("notes.txt"),
        cache.staging().join("notes.txt"),
    ];
    for path in &foreign {
        fs::write(path, b"theirs").expect("foreign");
    }
    let uppercase_key = cache.entries().join(key(2).name().to_uppercase());
    fs::create_dir(&uppercase_key).expect("dir");
    fs::write(uppercase_key.join(OUTPUT), b"theirs").expect("file");

    let cleared = cache.clear();
    assert_eq!(
        cleared,
        Removal {
            removed: 1,
            freed_bytes: 4,
            unrecognized_left: 3,
            ..Removal::default()
        }
    );
    for path in &foreign {
        assert_eq!(fs::read(path).expect("kept"), b"theirs");
    }
    assert_eq!(
        fs::read(uppercase_key.join(OUTPUT)).expect("kept"),
        b"theirs"
    );
    assert_eq!(
        names(&cache.root),
        [ROOT_MARKER, ENTRIES, "notes.txt", STAGING]
    );
}

/// NTFS opens `entries\<key>` ignoring case. A key spelled in capitals is not
/// a key: it is neither verified, nor removed as damaged, nor published over.
#[test]
fn a_key_spelled_in_capitals_is_unrecognized_and_left_as_found() {
    let scratch = Scratch::new("vc-case");
    let cache = cache(&scratch);
    // A real entry renamed to capitals: its files would pass every check.
    let renamed = key(1);
    published(&cache, &renamed, b"renamed");
    fs::rename(
        entry(&cache, &renamed),
        cache.entries().join(renamed.name().to_uppercase()),
    )
    .expect("rename");
    // An empty directory in capitals, which would read as damaged.
    let empty = key(2);
    fs::create_dir(cache.entries().join(empty.name().to_uppercase())).expect("dir");
    let before = snapshot(&cache.root);

    for key in [&renamed, &empty] {
        assert!(
            matches!(cache.verify(key), Lookup::Unrecognized),
            "{}",
            key.name()
        );
        assert_eq!(
            store(&cache, key, b"bytes").err(),
            Some(StoreFailure::EntryUnrecognized)
        );
    }
    assert_eq!(cache.clear().unrecognized_left, 2);
    assert_eq!(snapshot(&cache.root), before);
}

#[test]
fn an_attempt_that_is_no_longer_the_object_checked_is_not_removed() {
    let scratch = Scratch::new("vc-attempt-identity");
    let cache = cache(&scratch);
    let (checked, other) = (abandoned(&cache), abandoned(&cache));
    let other_identity = open_directory(&other, 0, SHARE_READ | SHARE_WRITE | SHARE_DELETE)
        .ok()
        .and_then(|directory| local_document::object_identity_of(&directory));
    assert!(other_identity.is_some());
    let before = snapshot(&cache.staging());

    assert_eq!(
        remove_attempt(&checked, other_identity),
        Removed::Unrecognized
    );
    assert_eq!(snapshot(&cache.staging()), before);
}

#[test]
fn an_entry_removal_that_stops_part_way_leaves_a_remainder_the_next_pass_removes() {
    let scratch = Scratch::new("vc-evict-part");
    let cache = cache(&scratch);
    let key = key(1);
    published(&cache, &key, b"partly");
    // Held without delete sharing: `view.mzML` goes first, then this refuses.
    let held = fs::OpenOptions::new()
        .read(true)
        .share_mode(SHARE_READ)
        .open(entry(&cache, &key).join(MANIFEST))
        .expect("hold the manifest");

    assert_eq!(
        cache.evict(u64::MAX),
        Removal {
            failed: 1,
            ..Removal::default()
        }
    );
    assert_eq!(names(&entry(&cache, &key)), [MANIFEST]);

    drop(held);
    assert_eq!(
        cache.evict(u64::MAX),
        Removal {
            removed: 1,
            ..Removal::default()
        }
    );
    assert!(!entry(&cache, &key).exists());
}
