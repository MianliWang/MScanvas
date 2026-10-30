use std::path::Path;

use mscanvas_proteowizard::Redactor;

use super::{
    Backend, Facts, KnownRoots, RECENT_ERROR_CAPACITY, RecentError, RecentErrors, recent_errors,
    render, summary,
};
use crate::preferences::UiPreferenceStore;
use crate::preview::dto::PreviewErrorDto;
use crate::preview::idle_provider::NoProcess;
use crate::preview::service::PreviewService;

/// What the whole summary may never exceed (ADR 0063). Bounded by
/// construction: every value has a maximum length, and so does the ring.
const MAX_SUMMARY_BYTES: usize = 8 * 1024;

const PROFILE: &str = r"C:\Users\Planted Person";
const USER: &str = "plantedperson";
const DATA: &str = "PlantedSample_042.raw";
const ENV: &str = "PLANTED_ENV=planted-env-value-7f3a";

/// Lower-cased fragments of the planted values, any one of which in the text
/// is a leak.
const SENTINELS: [&str; 6] = [
    "planted person",
    "plantedperson",
    "plantedsample",
    "planted_env",
    "planted-env-value",
    r"c:\users",
];

/// 2026-10-30T08:00:00Z.
const NOW: u64 = 1_793_347_200;

fn roots() -> KnownRoots {
    KnownRoots {
        program_files: Some(r"C:\Program Files".to_owned()),
        program_files_x86: Some(r"C:\Program Files (x86)".to_owned()),
        local_app_data: Some(format!(r"{PROFILE}\AppData\Local")),
        user_profile: Some(PROFILE.to_owned()),
    }
}

fn redactor() -> Redactor {
    let mut redactor = Redactor::default().with_path(Path::new(PROFILE), "<user-profile>");
    redactor.add_literal(USER, "<user-name>");
    redactor
}

fn ordinary() -> Facts {
    Facts {
        created_at: NOW,
        app_version: "0.1.0".to_owned(),
        build_profile: "release".to_owned(),
        build_commit: Some("0123456789abcdef0123456789abcdef01234567".to_owned()),
        saved_ui_language: Some("zh-CN".to_owned()),
        ui_preferences: "loaded".to_owned(),
        ui_preferences_problem: None,
        windows_version: Some("25H2".to_owned()),
        windows_build: Some("26200.6899".to_owned()),
        windows_edition: Some("Core".to_owned()),
        webview2: Some("141.0.3537.71".to_owned()),
        backend: Backend {
            checked: true,
            quarantined: false,
            state: Some("available".to_owned()),
            origin: Some("automatic".to_owned()),
            release: Some("3.0.26013".to_owned()),
            build_date: Some("Jan 13 2026".to_owned()),
            source_revision: Some("47b13cf".to_owned()),
            msconvert_sha256: Some("A1".repeat(32)),
            folder: Some(
                r"C:\Program Files\ProteoWizard\ProteoWizard 3.0.26013.47b13cf 64-bit".to_owned(),
            ),
            failure: None,
        },
        remembered_folder: true,
        remembered_refused_at_startup: None,
        remembered_not_saved: Some("rootUnresolved".to_owned()),
        recent_errors: vec![
            RecentError {
                code: "conversion_destination_refused".to_owned(),
                first: NOW - 600,
                last: NOW - 600,
            },
            RecentError {
                code: "preview_worker_unavailable".to_owned(),
                first: NOW - 300,
                last: NOW - 210,
            },
        ],
        dropped_errors: 3,
    }
}

#[test]
fn the_summary_has_stable_headings_english_keys_and_values_as_they_are() {
    let expected = r"MSCanvas diagnostics
Format: 1
Created: 2026-10-30T08:00:00Z

[Application]
Version: 0.1.0
Build profile: release
Build commit: 0123456789abcdef0123456789abcdef01234567
Saved UI language: zh-CN
UI preferences: loaded
UI preferences problem: none

[System]
Windows version: 25H2
Windows build: 26200.6899
Windows edition: Core
WebView2 Runtime: 141.0.3537.71

[ProteoWizard]
Checked this session: yes
Quarantined: no
State: available
Origin: automatic
Release: 3.0.26013
Build date: Jan 13 2026
Source revision: 47b13cf
msconvert SHA-256: A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1A1
Folder: <program-files>\ProteoWizard\ProteoWizard 3.0.26013.47b13cf 64-bit
Failure: none
Remembered folder: yes
Remembered folder refused at startup: none
Remembered folder not saved: rootUnresolved

[View cache]
Usage: not in this build

[Recent errors]
Held: 2 (at most 32; older dropped: 3)
- 2026-10-30T07:50:00Z conversion_destination_refused
- 2026-10-30T07:55:00Z preview_worker_unavailable (repeated until 2026-10-30T07:56:30Z)
";
    assert_eq!(render(&ordinary(), &roots(), &redactor()), expected);
}

/// The real collection path, over a provider that fails the test if anything
/// probes the backend, points it somewhere or starts a process.
#[test]
fn the_session_summary_neither_probes_nor_launches_anything() {
    let service = PreviewService::new(Box::new(NoProcess));
    let text = summary(&service, &UiPreferenceStore::unavailable());
    for line in [
        "Checked this session: no",
        "UI preferences: unavailable",
        "UI preferences problem: rootUnresolved",
        "Remembered folder: no",
    ] {
        assert!(
            text.contains(&format!("{line}\n")),
            "{line} is missing:\n{text}"
        );
    }
}

#[test]
fn an_unchecked_backend_says_so_rather_than_guessing() {
    let facts = Facts {
        backend: Backend {
            quarantined: true,
            ..Backend::default()
        },
        ..ordinary()
    };
    let text = render(&facts, &roots(), &redactor());
    for line in [
        "Checked this session: no",
        "Quarantined: yes",
        "State: unknown",
        "Release: unknown",
        "Folder: unknown",
        "Failure: none",
    ] {
        assert!(text.contains(&format!("{line}\n")), "{line} is missing");
    }
}

/// Every string field, every optional field, every error code and the folder
/// carry a planted profile path, user name, data file name or environment
/// variable, alone and combined, and none of them reaches the text.
#[test]
fn planted_identifiers_never_appear_whatever_field_they_are_planted_in() {
    let hostile = [
        PROFILE.to_owned(),
        USER.to_owned(),
        USER.to_uppercase(),
        DATA.to_owned(),
        ENV.to_owned(),
        "%PLANTED_ENV%".to_owned(),
        format!(r"{PROFILE}\Documents\{DATA}"),
        format!("3.0.26013 {DATA}"),
        format!("{USER}_code"),
        format!("ProteoWizard {USER}"),
        format!("0.1.0-{USER}"),
    ];
    let mut folders: Vec<String> = hostile.to_vec();
    folders.extend([
        format!(r"{PROFILE}\AppData\Local\Apps\ProteoWizard {USER}"),
        format!(r"{PROFILE}\AppData\Local\{DATA}"),
        format!(r"{PROFILE}\{DATA}\ProteoWizard"),
        format!(r"\\?\{PROFILE}\AppData\Local\Apps\PLANTED_ENV"),
        format!(r"D:\{USER}\{DATA}\ProteoWizard"),
        format!(r"C:\Program Files\{DATA}\ProteoWizard 3.0"),
        format!(r"C:\Program Files\ProteoWizard\ProteoWizard {DATA}"),
        format!(r"C:\Program Files\ProteoWizard 3.0 {DATA}"),
        format!(r"C:\Program Files\pwiz-bin-windows-{DATA}"),
    ]);

    for value in &hostile {
        for folder in &folders {
            let planted = Some(value.clone());
            let facts = Facts {
                created_at: NOW,
                app_version: value.clone(),
                build_profile: value.clone(),
                build_commit: planted.clone(),
                saved_ui_language: planted.clone(),
                ui_preferences: value.clone(),
                ui_preferences_problem: planted.clone(),
                windows_version: planted.clone(),
                windows_build: planted.clone(),
                windows_edition: planted.clone(),
                webview2: planted.clone(),
                backend: Backend {
                    checked: true,
                    quarantined: false,
                    state: planted.clone(),
                    origin: planted.clone(),
                    release: planted.clone(),
                    build_date: planted.clone(),
                    source_revision: planted.clone(),
                    msconvert_sha256: planted.clone(),
                    folder: Some(folder.clone()),
                    failure: planted.clone(),
                },
                remembered_folder: true,
                remembered_refused_at_startup: planted.clone(),
                remembered_not_saved: planted,
                recent_errors: vec![RecentError {
                    code: value.clone(),
                    first: NOW,
                    last: NOW + 1,
                }],
                dropped_errors: 0,
            };
            let text = render(&facts, &roots(), &redactor()).to_lowercase();
            for sentinel in SENTINELS {
                assert!(
                    !text.contains(sentinel),
                    "{sentinel} leaked from {value} / {folder}:\n{text}"
                );
            }
        }
    }
}

#[test]
fn a_folder_is_a_root_placeholder_and_an_installer_shaped_remainder_or_withheld() {
    let cases = [
        (
            r"C:\Program Files\ProteoWizard\ProteoWizard 3.0.26013.47b13cf 64-bit".to_owned(),
            r"<program-files>\ProteoWizard\ProteoWizard 3.0.26013.47b13cf 64-bit",
        ),
        // Windows compares without case, and a canonical path keeps its
        // verbatim prefix.
        (
            r"\\?\C:\PROGRAM FILES\ProteoWizard".to_owned(),
            r"<program-files>\ProteoWizard",
        ),
        // Compared by component, not by prefix: this is not under the first.
        (
            r"C:\Program Files (x86)\ProteoWizard".to_owned(),
            r"<program-files-x86>\ProteoWizard",
        ),
        (
            format!(r"{PROFILE}\AppData\Local\Apps\ProteoWizard 3.0.26013 64-bit"),
            r"<local-app-data>\Apps\ProteoWizard 3.0.26013 64-bit",
        ),
        (
            format!(r"{PROFILE}\AppData\Local\ProteoWizard\pwiz-bin-windows-x86_64-vc145-release"),
            r"<local-app-data>\ProteoWizard\pwiz-bin-windows-x86_64-vc145-release",
        ),
        (
            format!(r"{PROFILE}\Desktop\pwiz"),
            r"<user-profile>\<withheld>",
        ),
        (
            r"C:\Program Files\Lab Tools\ProteoWizard".to_owned(),
            r"<program-files>\<withheld>",
        ),
        (
            r"C:\Program Files".to_owned(),
            r"<program-files>\<withheld>",
        ),
        (
            r"D:\Tools\ProteoWizard".to_owned(),
            r"<other-folder>\<withheld>",
        ),
        (
            r"\\server\share\ProteoWizard".to_owned(),
            r"<other-folder>\<withheld>",
        ),
    ];
    for (folder, expected) in cases {
        let facts = Facts {
            backend: Backend {
                folder: Some(folder.clone()),
                ..ordinary().backend
            },
            ..ordinary()
        };
        let text = render(&facts, &roots(), &redactor());
        assert!(
            text.contains(&format!("Folder: {expected}\n")),
            "{folder} should read {expected}:\n{text}"
        );
    }
}

#[test]
fn the_largest_summary_every_shape_admits_stays_within_its_bound() {
    let code = |index: usize| format!("{}{index:02}", "c".repeat(62));
    let longest_folder_part = format!("ProteoWizard {}", "9".repeat(51));
    let facts = Facts {
        created_at: u64::from(u32::MAX),
        app_version: "1".repeat(32),
        build_profile: code(0),
        build_commit: Some("f".repeat(40)),
        saved_ui_language: Some("zh-CN".to_owned()),
        ui_preferences: code(1),
        ui_preferences_problem: Some(code(2)),
        windows_version: Some("9".repeat(8)),
        windows_build: Some("9".repeat(32)),
        windows_edition: Some("W".repeat(32)),
        webview2: Some("9".repeat(32)),
        backend: Backend {
            checked: true,
            quarantined: true,
            state: Some(code(3)),
            origin: Some(code(4)),
            release: Some("9".repeat(32)),
            build_date: Some("Dec 31 9999".to_owned()),
            source_revision: Some("f".repeat(40)),
            msconvert_sha256: Some("F".repeat(64)),
            folder: Some(format!(
                r"C:\Program Files (x86)\{longest_folder_part}\{longest_folder_part}\{longest_folder_part}"
            )),
            failure: Some(code(5)),
        },
        remembered_folder: true,
        remembered_refused_at_startup: Some(code(6)),
        remembered_not_saved: Some(code(7)),
        recent_errors: (0..RECENT_ERROR_CAPACITY)
            .map(|index| RecentError {
                code: code(index + 10),
                first: u64::from(u32::MAX) - 1,
                last: u64::from(u32::MAX),
            })
            .collect(),
        dropped_errors: u64::MAX,
    };
    let text = render(&facts, &roots(), &Redactor::default());
    assert!(
        !text.contains("<withheld>"),
        "every value here is admitted, so the bound is measured at its largest:\n{text}"
    );
    assert!(
        text.len() <= MAX_SUMMARY_BYTES,
        "{} bytes exceeds {MAX_SUMMARY_BYTES}",
        text.len()
    );
}

#[test]
fn the_ring_keeps_codes_coalesces_repeats_and_counts_what_it_dropped() {
    let mut ring = RecentErrors::default();
    ring.note("a_code", 10);
    ring.note("a_code", 20);
    ring.note("b_code", 30);
    ring.note("a_code", 40);
    ring.note(DATA, 50);
    let (entries, dropped) = ring.snapshot();
    let seen: Vec<(&str, u64, u64)> = entries
        .iter()
        .map(|entry| (entry.code.as_str(), entry.first, entry.last))
        .collect();
    assert_eq!(
        seen,
        [
            ("a_code", 10, 20),
            ("b_code", 30, 30),
            ("a_code", 40, 40),
            ("unrecognized_code", 50, 50),
        ]
    );
    assert_eq!(dropped, 0);

    for index in 0..40_u64 {
        ring.note(&format!("code_{index}"), 100 + index);
    }
    let (entries, dropped) = ring.snapshot();
    assert_eq!(entries.len(), RECENT_ERROR_CAPACITY);
    assert_eq!(dropped, 4 + 40 - RECENT_ERROR_CAPACITY as u64);
    assert_eq!(
        entries.last().map(|entry| entry.code.as_str()),
        Some("code_39")
    );
}

#[test]
fn a_boundary_error_joins_the_ring_by_its_code_alone() {
    // Not written as a literal after `new(`: the repository check would read
    // it as a code the boundary sends to the webview.
    const PROBE: &str = "environment_diagnostics_ring_probe";
    // The ring is process-wide and the rest of the suite builds errors in
    // parallel, so 32 other codes could push the probe out before it is read.
    // Building it again and reading at once settles that without weakening
    // what is asserted.
    let joined = (0..1_000).any(|_| {
        let error = PreviewErrorDto::new(PROBE, format!("{DATA} could not be read"), false)
            .with_detail(format!(r"{PROFILE}\{DATA}"));
        error.kind == PROBE && recent_errors().0.iter().any(|entry| entry.code == PROBE)
    });
    assert!(joined, "the probe's code never reached the ring");
    let (entries, _) = recent_errors();
    assert!(
        entries
            .iter()
            .all(|entry| !entry.code.to_lowercase().contains("plantedsample"))
    );
}
