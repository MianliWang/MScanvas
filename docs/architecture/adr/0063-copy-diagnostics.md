# ADR 0063 — Copy diagnostics: a redacted environment summary the user shares

Status: **Accepted (2026-10-30)**; see the
[owner decision](#owner-decision-2026-10-30-a0063), which answers questions 1–5.
Proposed on 2026-10-30. The owner asked that day for every backend
item that can be done now to start; this record states the recommendations that
lane implemented, and each choice the owner has not made is listed
[at the end](#open-questions-for-the-owner). The Rust side is implemented on
branch `be/copy-diagnostics`. No interface calls it yet.
Related: [0005](0005-mzml-preview-boundary.md),
[0017](0017-redacted-conversion-diagnostics-export.md),
[0044](0044-conversion-configuration-authority.md),
[0055](0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md),
[0060](0060-one-click-view-of-a-thermo-raw-file-through-a-conversion-cache.md);
the [after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#74-future-capabilities)
and the beta-1 [install and support guide](../../release/beta-1/INSTALL_AND_SUPPORT.md#report-a-problem).

## Context

ENV-004 asks for "a redacted, shareable environment summary". Today a bug
report asks the user to type four facts by hand: the MSCanvas version, the
Windows edition, version and build that `winver` shows, the ProteoWizard build
the banner names, and the input format. Two of them are hard to get right. The
installed version reads `0.1.0` for every beta, because the package version is
not bumped per prerelease, and the banner names the ProteoWizard release but
not which executable ran.

Diagnostics upload stays refused
([plan, section 7.6](../../development/AFTER_BETA1_PLAN.md#76-refused-or-not-adopted)).
So this is text the user copies and pastes into an issue themselves. It is not
the conversion failure export of ADR 0017, which is a JSON file holding
redacted ProteoWizard text; this summary holds no backend text beyond three
shape-checked identity tokens (the release, the build date and the source
revision).

## Decisions

### 1. A closed list of facts

| Section | Key | Source | Admitted shape |
|---|---|---|---|
| — | `Format`, `Created` | this layout's number; the clock, as RFC 3339 UTC | fixed |
| Application | `Version` | the package version | starts with a digit; digits, letters, `.`, `-`, `+`; at most 32 |
| Application | `Build profile` | `release` or `debug` | code |
| Application | `Build commit` | `GITHUB_SHA` at compile time, which GitHub Actions sets for every CI and release build; a pull-request build records its merge commit | 40 hex digits; `unknown` when absent, `<withheld>` when malformed |
| Application | `Saved UI language` | the preference record's locale, `none` when nothing is saved, or `unknown` when the record could not be read or used | `en` or `zh-CN` |
| Application | `UI preferences`, `UI preferences problem` | the preference store's read outcome and its owned problem code | code |
| System | `Windows version`, `Windows build`, `Windows edition` | `DisplayVersion`, `CurrentBuildNumber`.`UBR` and `EditionID` under `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion`, what `winver` reads. `ProductName` is not read: it says "Windows 10" on Windows 11 | letters and digits, at most 8; digits and dots; letters and digits, at most 32 |
| System | `WebView2 Runtime` | the runtime's own version string | digits and dots |
| ProteoWizard | `Checked this session`, `Quarantined` | whether a reading exists; whether the session stopped trusting the backend | `yes`/`no` |
| ProteoWizard | `State`, `Origin`, `Failure` | the last reading's verdict, `automatic`/`chosen`, and its failure kind | code |
| ProteoWizard | `Release`, `Build date`, `Source revision` | the reported build identity; the revision from the identity the last reading bound | digits and dots; `Jan 13 2026`; 6–40 hex digits |
| ProteoWizard | `msconvert SHA-256` | the digest discovery bound to the executable the last reading described | 64 hex digits |
| ProteoWizard | `Folder` | which known root the usable reading's folder sits under, never the folder (decision 4) | one of five placeholders |
| ProteoWizard | `Remembered folder`, `… refused at startup`, `… not saved` | whether a folder is remembered, and the two owned codes beside it. Never the remembered path | `yes`/`no`; code |
| View cache | `Usage` | `not in this build` until ADR 0060's slice 2 gives the session a cache; then the held cache's usage, never by opening one | fixed |
| Recent errors | `Held`, then one line per code | the ring of decision 5 | code, RFC 3339 times |

A *code* is a letter followed by letters, digits and underscores, at most 64.

The backend lines come from what the session already holds: the last reading
and the identity it bound. Building the summary probes nothing and launches
nothing, so it can be taken while a conversion runs or after the backend was
quarantined, which is when it is most needed. Before the first reading the
section says `Checked this session: no`, and every value a reading would give,
`Failure` included, is `unknown`. `Quarantined` and the three
`Remembered folder` lines are facts about the session and the preference
record, known without a reading, and are stated as they are.

Every backend value describes one reading. A configuration read or a conversion
can bind another build without taking a new reading, so the source revision and
the `msconvert` digest are taken from the bound identity only while the binding
the reading was taken under is still current, and are `unknown` after it
changed, never the new build's facts beside the old reading's release and
folder.

### 2. What never goes in

No file name of the user's data and no name, path or count from the workspace,
a project or a conversion; no full path, and nothing under the profile other
than as a placeholder; no runtime environment variable (the version and the
build commit are compile-time values); no user name; no ProteoWizard help text
beyond the release, the build date and the source revision, each admitted only
in its own shape; and no error summary or detail. Only those environment variables are read that
locate the profile, the local application data and Program Files, or that name
the account, and they are used only to recognise and redact.

The recent error codes of decision 5 do say something about the user's work: a
code can name the input's vendor (`sciex_companion_missing`) or a feature that
was used (`targeted_evidence_absent`), and its times say when.

### 3. Codes come from owned ids; every value passes its shape and the redactor, or is withheld whole

There is no free-text field. The first line of defence covers the code fields
only: a *code* is a stable id the repository defines — a backend failure kind,
a preference problem, a boundary error kind — never text a person or a file
supplied. As of 2026-10-30 every source of a code field and every
`PreviewErrorDto::new` kind is such an id. The version and the build commit are
compile-time values. The other values are not MSCanvas's own: the Windows facts
come from the registry, the WebView2 version from the runtime, and the
ProteoWizard release, build date and source revision from the installed tool's
own help text. Those are held by their shapes alone, none of which admits a
path separator or a colon, so loosening one of those shapes removes the only
defence that value has.

The second line is shape and redaction. Each value must match its own shape
from the table and must come back unchanged from a redactor that knows the
profile path. A value whose shape admits a word — a code, the Windows version
and edition, the application version — must also not hold the account name
(`USERNAME` or `USER`) as a whole token: the whole value, or a run with the
value's edge or `_`, `.`, `-`, `+` or a space on each side, compared without
case. A value that fails any of these is replaced whole by `<withheld>`;
nothing is partly rewritten.

A shape that admits no free word — the language (`en` or `zh-CN`), a dotted
number, the build date, hex — is not checked for the account name. The name
can only match one by chance, and withholding it would then say the name is
one of its tokens: a user named `jan` would lose every January build date,
beside a release number that already gives the day, and `en` or `cn` would lose
the language line.

The account name is not matched as a substring. A shared workstation's `lab`
would then withhold `available` and `unavailable` in every line that can hold
them, and which lines were withheld would spell the name out. As a token it
still withholds a word-shaped value the name is part of, and the withheld line
then says that the name is one of that line's tokens: a user named `core`
loses `Windows edition: Core`. This small side channel is accepted where a word
can appear: showing the value instead would write the name whenever it really
is there.

The second line alone does not stop a code-shaped name nothing knows, such as a
file stem without its extension, so a change that routes supplied text into a
code field or an error kind breaks the first line, and must not be made.

### 4. The ProteoWizard folder is named only by the known root it sits under

ADR 0005's 2026-10-30 amendment says the usable reading's folder "never enters
diagnostics or project documents", and this summary keeps to it. The folder is
never written. The `Folder` line names only the known root it sits under —
`<program-files>`, `<program-files-x86>`, `<local-app-data>` or
`<user-profile>`, most specific first — or `<other-folder>` when it is under
none of them, and `unknown` without a usable reading. Roots compare by
component and without case, as Windows does. So
`C:\Program Files\ProteoWizard\ProteoWizard 3.0.26013.47b13cf 64-bit` reads
`<program-files>`, and nothing a person named, inside the profile or elsewhere,
can appear. The line tells a machine-wide installation from a per-user or
portable copy; two side-by-side installations are told apart by the release,
the source revision and the `msconvert` SHA-256.

### 5. A bounded, in-memory ring of boundary error codes

Every boundary error is built through `PreviewErrorDto::new`, so that is where
its code, and only its code, joins the ring. The one boundary error built
elsewhere, `figure_preview_too_large`, now goes through it too. The ring holds
32 entries and counts the ones it drops. Consecutive repeats of one code are one
entry with a first and a last time, so a retry loop or a failure projected
again cannot push every other code out. A value that is not shaped like a code
is kept as `unrecognized_code`. The ring lives for the process and is never
written anywhere. A code can name the input's vendor (`sciex_*`) or a feature
that was used (`targeted_*`), and its times say when (decision 2).

It says what the native boundary *produced* this session, which is close to,
but not exactly, what the interface showed: an error built and then discarded
is counted too. A search of the native sources on 2026-10-30 found no
`ok_or`, `unwrap_or`, `map_or` or `or` that builds one eagerly.

### 6. Format

Plain text, so it pastes into an issue as it is. The first line is
`MSCanvas diagnostics`, then `Format: 1` and `Created`. Sections are
`[Application]`, `[System]`, `[ProteoWizard]`, `[View cache]` and
`[Recent errors]`, each a run of `Key: value` lines. Keys are English and
stable, so support can read a summary whatever the interface language was.
Values are written as they are, never translated. `Format` changes when a
heading or a key does. A recent error is
`- <first time> <code>`, followed by `(repeated until <last time>)` when it
repeated.

### 7. Bounds

Every value has a maximum length, the folder is one fixed placeholder, and the
ring holds 32 lines. The largest summary every shape
admits is held under 8 KiB by a test.

### 8. Nothing is written, sent or launched

The summary is returned to the caller and goes no further: no file, no log, no
network, no clipboard from Rust, no process. Reading the saved language reads
the preference record; nothing writes it.

### 9. One narrow command

`read_environment_diagnostics` takes no argument and returns the text. Its only
error is the existing `preview_worker_unavailable`, so it adds no boundary
error code for the interface to account for. It runs off the async runtime,
because the preference record lives on the profile volume.

### 10. The interface is the interface lane's, and is recorded here

Recommended, and accepted on 2026-10-30: a **Copy diagnostics** button in
Settings that shows the text in a read-only box, with **Copy** beside it and one sentence saying that nothing
was sent and that the user should read it before sharing. Copying uses the
platform's text clipboard write from that button's click, which needs no Tauri
capability and reads nothing. This departs from the posture of ADR 0030 and
ADR 0034, where the clipboard is reached from Rust only. `check_repo.py` checks
that posture through the capabilities and `package.json`, so a
`navigator.clipboard.writeText` call still passes it; the owner accepted this
route on 2026-10-30 (question 4, A0063). The release guide's
"For the environment, give" list then points at the button.

## Alternatives

- **Record errors at each command in `lib.rs`.** Exact about what was returned,
  but about 84 call sites, a large diff in the most shared file, and a new
  command that forgot to record would be silently missing. Tauri 2.11 gives no
  public hook on command results.
- **Record errors when they are serialized.** Catches exactly what crossed the
  boundary, but a side effect in `Serialize` is surprising, and a polled state
  that carries a failure would record it on every poll.
- **The folder with only the profile part replaced.** What the task first
  suggested. It leaks a folder the user named under Program Files or on another
  drive, and a planted data-file name in such a folder appears in the text. It
  would also amend ADR 0005.
- **A root placeholder and an installer-shaped remainder**, such as
  `<program-files>\ProteoWizard\ProteoWizard 3.0.26013.47b13cf 64-bit`. Names
  the installation directly, but writes a derived form of the path ADR 0005
  keeps out of diagnostics, so it needs the owner to amend ADR 0005. Its
  grammar must also be tight enough that a folder a person renamed cannot pass:
  the first draft of this record admitted `pwiz-bin-windows-wang-lab-copy` and
  `ProteoWizard 2026.10.30`.
- **No folder line at all.** Equally safe, but loses whether a machine-wide
  installation or a per-user copy ran, which the root alone says.
- **A `Verified build: yes/no` line now.** The verified build is ADR 0055's
  `msconvert.exe` digest. Draft PR #161 adds that constant; this lane would have
  been a fourth copy of it. The digest itself is in the summary, so support can
  compare it today.
- **The account check on every value**, as an earlier draft of this record did.
  Withholds a value the name can only match by chance, and the withheld line
  then points at the name: `jan` loses `Jan 13 2026` while `Release: 3.0.26013`
  already gives the day.
- **The account check on codes only.** Narrower still, but a word-shaped value
  that is not a code, such as the Windows edition or the application version,
  would then carry a planted name through.
- **JSON.** Machine-readable, but a user pasting into an issue reads plain text
  more easily, and nothing reads the summary by program.
- **A saved file, like ADR 0017.** A file needs a save dialog and a place, and
  this is short enough to paste.
- **Rust writes the clipboard** through the clipboard plugin's Rust API, as Copy
  plot does. Keeps the repository's "the clipboard is reached from Rust"
  posture, but needs a second command beside the read, or one read that also
  copies before the user has seen the text.
- **Workspace contents by family** (how many mzML, Thermo RAW, Shimadzu or
  SCIEX rows). Answers the guide's input-format question, but adds counts of
  workspace contents. Part of it already shows through recent error codes
  (`sciex_*`, `targeted_*`; decision 5). Left out by the owner on 2026-10-30
  (question 5, A0063).

## Consequences

- `PreviewErrorDto::new` takes a process-wide lock once per error built. The
  cost is a short critical section, and the lock never panics.
- `project::format_rfc3339` and `BackendAuthority::bound_identity` are visible
  within the crate.
- The registration test lists the command and exempts it from "the frontend
  calls every command" until the interface lane adds its caller.
- When ADR 0060's slice 2 gives the session a view cache, the `[View cache]`
  section reports its usage and `Format` stays `1` only if the keys do not
  change.

## Owner decision, 2026-10-30 (A0063)

Shown the decisions that blocked work on 2026-10-30, decision A0063 among them
(`docs/development/OWNER_DECISIONS_V511.md`, PR #186), the owner replied
"全部按推荐，继续" ("all as recommended, continue"). A0063 lists this record's
questions 1–5, and each is answered as recommended:

1. **The folder (decision 4):** the known root only. ADR 0005's 2026-10-30
   amendment stands as it is; no installer-shaped remainder.
2. **The error ring's recording point (decision 5):** at `PreviewErrorDto::new`,
   accepting that an error built and then discarded counts.
3. **The verified-build line:** add `Verified build: yes/no` once PR #161
   merges, reading its constant rather than a copy. Not done yet: #161 is open.
4. **The interface and the copy route (decision 10):** a Settings button, a
   read-only preview and the platform text clipboard written from that
   button's click. The departure from ADR 0030 and ADR 0034's "the clipboard is
   reached from Rust" is accepted for this button only; those records are not
   amended. The interface lane builds the button after PR #164.
5. **Workspace contents by family:** left out until a support case needs it.
   That a recent error code can name a vendor or a feature (decision 5) is
   accepted; no code allowlist or category is added to the ring.

Question 6 was added after A0063 was written and is not answered by it; it
stays open below.

## Open questions for the owner

1. *Answered on 2026-10-30 (A0063, [owner decision](#owner-decision-2026-10-30-a0063)):*
   **The folder (decision 4).** The known root only.
2. *Answered on 2026-10-30 (A0063):* **The error ring's recording point
   (decision 5).** At `PreviewErrorDto::new`.
3. *Answered on 2026-10-30 (A0063):* **The verified-build line.** Added once
   PR #161 merges.
4. *Answered on 2026-10-30 (A0063):* **The interface and the copy route
   (decision 10).** A Settings button, a read-only preview and the platform
   text clipboard.
5. *Answered on 2026-10-30 (A0063):* **Workspace contents by family.** Left out.
6. **Where the account name is checked (decision 3).** Open. Recommended: only values
   whose shape admits a word, as a whole token. The alternatives are every
   value as a whole token, every value as a substring, or codes only.
