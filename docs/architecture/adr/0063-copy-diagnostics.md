# ADR 0063 — Copy diagnostics: a redacted environment summary the user shares

Status: **Accepted (2026-10-30)**; see the
[owner decision](#owner-decision-2026-10-30-a0063), which answers questions 1–5,
and the [owner decision of 2026-10-31](#owner-decision-2026-10-31), which
answers questions 6 and 7.
The [owner decision of 2026-11-03](#owner-decision-2026-11-03) answers question 8.
Proposed on 2026-10-30. The owner asked that day for every backend
item that can be done now to start; this record states the recommendations that
lane implemented, and each choice the owner has not made is listed
[at the end](#open-questions-for-the-owner). The Rust side is implemented on
branch `be/copy-diagnostics`. No interface calls it yet.
On 2026-11-03: the Rust side had merged in PR #178, and branch
`ui/diagnostics-button` added the Settings button and its preview (question 4),
the `Verified build` line (question 3) and a failed conversion's outcome in the
ring (question 7). The accepted text below stays as it was accepted; a dated
note beside it says what was built.
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

*As built, 2026-11-03:* the table above stays as it was accepted, and the summary
differs from it in two lines.

- `Verified build` is a new `ProteoWizard` line after `msconvert SHA-256`
  (question 3): whether that digest is ADR 0055's verified build, read from the
  adapter's `VERIFIED_MSCONVERT_SHA256`, never a copy of it. Question 3 says
  `yes/no`. The line follows the digest, so it is `unknown` after the binding
  changed as well as without a digest; that third value follows from having no
  digest to compare and is not an owner decision.
- `Usage` under `View cache` still says `not in this build`, which is not an owner
  decision. ADR 0060's slice 2 has landed, but it binds only the folder the cache
  would live under, and no interface calls `describe_view_cache` or
  `clear_view_cache`, because the owner moved **View with…** and Clear view cache
  to the next slice (A0060-split, 2026-11-03). That answer does not cover this
  line. `describe_view_cache` goes through `ViewCache::open`, which makes the cache
  if there is none, and the table says never by opening one, so the line stays until
  the session holds an open cache.

### 2. What never goes in

No file name of the user's data and no name, path or count from the workspace,
a project or a conversion; no full path, and nothing under the profile other
than as a placeholder; no runtime environment variable (the version and the
build commit are compile-time values); no user name; no ProteoWizard help text
beyond the release, the build date and the source revision, each admitted only
in its own shape; and no error summary or detail. Only those environment variables are read that
locate the profile, the local application data and Program Files, or that name
the account, and they are used only to name a root and to check for the
account name.

The recent error codes of decision 5 do say something about the user's work: a
code can name the input's vendor (`sciex_companion_missing`) or a feature that
was used (`targeted_evidence_absent`), and its times say when. Once a failed
conversion's outcome joins the ring (question 7, decided 2026-10-31,
implemented after PR #161 merges), the ring also names conversion outcomes, and
their times say when a conversion failed. An outcome is an owned id, so it adds
no text.

*As built, 2026-11-03:* that slice has landed, so the ring does name conversion
outcomes.

### 3. Codes come from owned ids; every value passes its shape, or is withheld whole

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

*As built, 2026-11-03:* a conversion outcome (question 7) is a code too, an owned
`&'static str` id.

The second line is shape. Each value must match its own shape from the table.
No shape admits a path separator or a colon, so a redactor that knows the
profile path could never change an admitted value, and none runs. A value
whose shape admits a word — a code, the Windows version
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

Every `PreviewErrorDto` is built through `PreviewErrorDto::new`, so that is
where its code, and only its code, joins the ring. The one built elsewhere,
`figure_preview_too_large`, now goes through it too. The ring holds
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

*Found on 2026-11-03:* `file_identity` does build and discard one, through
`.ok()`, so `file_not_resolvable` can also mean that a path was looked at and not
found.

Until the slice of question 7 lands, the ring holds `PreviewErrorDto` kinds
only. These are not errors at the boundary, so they are not in it:

- a conversion that ran and failed, which is a report whose `outcome` and
  `detailedOutcome` say why;
- a refusal carried in an `Ok` outcome: opening an output, clearing the
  workspace, reclaiming staging, a spectrum domain and a conversion
  configuration;
- a preference save that failed, whose `problem` is part of its `Ok` result.

So `Held: 0` does not mean that no conversion failed this session. On
2026-10-31 the owner decided that a failed conversion's outcome will join the
ring (question 7): when a conversion that ran ends in failure, its report's
`detailedOutcome`, or its `outcome` when it has none, is recorded where the
report is projected. That projection is PR #161's code, so this is implemented
after #161 merges; until then the ring holds only `PreviewErrorDto` kinds, as
stated above. Nothing else in the list above joins it.

*As built, 2026-11-03:* the slice of question 7 has landed, so a conversion that
ran and ended in failure is in the ring and off the list above. `Held: 0` still
does not mean that nothing was refused this session. What is recorded is the
report's `detailedOutcome`, or its `outcome` when it has none: a set whose
publication stopped partway is `partially_finalized`, and a set that published
whole but cannot be adopted keeps `fully_finalized`, the one failure that reads
like a success. A stop is not a failure and is not recorded.

Two readings of question 7 here are not owner decisions:

- "Where the report is projected" is built as where the session builds its report
  from the run (`WorkspaceConversionReport::of`, `SciexAttemptSettlement::of`), so
  it is recorded once per run. It is not recorded where the report is serialized:
  a queue is read again and again, and two failed rows read in turn would push
  every other code out of the ring.
- A view conversion (ADR 0060) has no report and builds neither of those, so it is
  recorded once, as the kind of the `PreviewErrorDto` the view run returns. That
  kind is usually the failure's coarse `stable_id()`: where a queue report records
  `missing_output`, a view conversion records `output_rejected`.

### 6. Format

Plain text, so it pastes into an issue as it is. The first line is
`MSCanvas diagnostics`, then `Format: 1` and `Created`. Sections are
`[Application]`, `[System]`, `[ProteoWizard]`, `[View cache]` and
`[Recent errors]`, each a run of `Key: value` lines. Keys are English and
stable, so support can read a summary whatever the interface language was.
Values are written as they are, never translated. `Format` changes when a
heading or a key does. A recent error is
`- <first time> <code>`, followed by `(repeated until <last time>)` when it
repeated, even within the same second.

*As built, 2026-11-03:* `Format` is `2`, because `Verified build` is a new key.
Format 1 reached no interface. This follows from the rule above and is not an
owner decision.

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

Owner decision, 2026-11-03: the sentence is not shown; #202 as built stands
(question 8, [owner decision](#owner-decision-2026-11-03)).

*As built, 2026-11-03, not an owner decision:*

- The button reads when pressed, and again as **Read again**. A second read leaves
  the screen as it is until it answers, with **Copy** refused meanwhile, and the
  result of a copy still out when it was pressed is not shown, because that copy
  took the old text. The answer shows the new text from its first line. A failed read
  takes the text and **Copy** away, so if either had the keyboard it goes to
  **Read again**.
- The box is a fixed 200 px and scrolls inside the dialog's body, which scrolls too.
  Measured with the 42-line fixture at 1366x768 and 960x640: a 198 px client area
  holding 822 px, so about ten lines show, and `[ProteoWizard]` (line 19) and
  `[Recent errors]` (line 38) are reached by scrolling inside the box. **Copy** does
  not wait for them to be read. Decision 2 says that those last lines can name a
  vendor and a time. Decision 10 sets no height, and the answer to question 8 did not
  cover it. The alternative is a box that grows with the text, so that only the body
  scrolls. Its cost: the text reaches about 1920 px with a full ring, and **Copy**, at
  the top of the box, scrolls away while the end is read. This is unanswered.
- Closing Settings drops the text. The clipboard's refusal is shown above the text,
  because the text stays selectable by hand. Support is the last section, below
  anything a save or the stored record has to say, because the text makes it tall.
  Restore and the conversion history sit below those blocks too, so an unusable
  record is in the dialog's body when Settings opens. Support makes the body scroll
  at 1366x768, so where a Tab lands is brought into view: past Close it wraps to the
  first choice without scrolling. Pressing the text does not scroll, so the clipboard's
  refusal stays in sight while the text is selected. The box comes into view when the
  keyboard goes to it, and **Copy** with its result or refusal each time a copy answers,
  because a person can press from the body's edge.
- `check_repo.py` holds the route to this button (question 4) as far as a text
  search can. It refuses the words `navigator.clipboard` in any other non-test file
  of the interface's source, and in this one anything but one `writeText` call. It
  does not see `const { clipboard } = navigator`, `navigator["clipboard"]` or
  `document.execCommand("copy")`, so those are for review to refuse.
- The release guide's list points at the button from the first release that has
  it; beta 1's guide describes beta 1, which does not.

*As built, 2026-11-04, not an owner decision:*

- The answer shows the new text from its first line wherever the keyboard is. A
  reader who has moved keeps the keyboard and, when the text answers, the body where
  they are; a failure comes into view.
- A Tab with Ctrl, Alt or Meta held moves no focus, so it does not count as a Tab,
  and pressing the text after one does not scroll.

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
  *Adopted on 2026-11-03, once #161 had merged, reading that constant (decision 1).*
- **The account check on every value**, as an earlier draft of this record did.
  Withholds a value the name can only match by chance, and the withheld line
  then points at the name: `jan` loses `Jan 13 2026` while `Release: 3.0.26013`
  already gives the day.
- **The account check on codes only.** Narrower still, but a word-shaped value
  that is not a code, such as the Windows edition or the application version,
  would then carry a planted name through.
- **No account check at all**, relying on owned sources. Every value the check
  reads is an owned code, a compile-time value or a registry fact, so in
  production it fires only by chance, and then the withheld line points at the
  name: an account named `sciex` loses `sciex_companion_missing`, the line
  support needs most. The cost is the only defence in depth against a later
  change that routes supplied text into a code field.
- **Every value through the profile redactor as well**, as an earlier draft did.
  Every shape already excludes a path separator and a colon, and the
  redactor only knows absolute paths, so it could never change an admitted
  value; it cost a canonicalisation and Win32 name lookups per summary.
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
- *2026-11-03:* the frontend calls the command, so the registration test no longer
  exempts it. `Format` is `2` (decision 6), and the line above holds for `2`. Slice 2
  has landed and the section does not report usage yet; the note under decision 1
  says why. `VERIFIED_MSCONVERT_SHA256` is public from the ProteoWizard adapter, so
  this summary and ADR 0055's tier read one value.

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
   *Done on 2026-11-03. It also says `unknown`, which is not an owner decision (the
   note under decision 1).*
4. **The interface and the copy route (decision 10):** a Settings button, a
   read-only preview and the platform text clipboard written from that
   button's click. The departure from ADR 0030 and ADR 0034's "the clipboard is
   reached from Rust" is accepted for this button only; those records are not
   amended. The interface lane builds the button after PR #164.
   *Done on 2026-11-03.*
5. **Workspace contents by family:** left out until a support case needs it.
   That a recent error code can name a vendor or a feature (decision 5) is
   accepted; no code allowlist or category is added to the ring.

Questions 6 and 7 were added after A0063 was written and are not answered by
it; the owner answered them on 2026-10-31 (below).

## Owner decision, 2026-10-31

Shown five questions on 2026-10-31, each with a recommendation, questions 6 and
7 of this record among them, the owner replied "全部按推荐" ("all as
recommended"). Both are answered as recommended:

6. **Where the account name is checked (decision 3):** as implemented. Only a
   value whose shape admits a word is checked, and only for the account name as
   a whole token. This changes no code.
7. **A failed conversion's outcome in the ring (decision 5):** yes. When a
   conversion that ran ends in failure, its report's `detailedOutcome`, or its
   `outcome` when it has none, joins the ring, recorded where the report is
   projected. That projection is PR #161's code, so this is implemented after
   #161 merges, not on this branch. Decision 2 says that the ring will then
   also hold conversion outcomes; until that slice lands it holds only
   `PreviewErrorDto` kinds, as decision 5 states.
   *Done on 2026-11-03; the notes beside decisions 2 and 5 say what the ring now
   holds and where each is recorded.*

## Owner decision, 2026-11-03

Shown a list of decisions on 2026-11-03, question 8 of this record among them
(P202), the owner replied "全部按推荐" ("all as recommended"). It is answered as
recommended:

8. **The sentence of decision 10:** not shown. #202 as built stands.

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
6. *Answered on 2026-10-31 ([owner decision](#owner-decision-2026-10-31)):*
   **Where the account name is checked (decision 3).** As recommended: only values
   whose shape admits a word, as a whole token. The alternatives were every
   value as a whole token, every value as a substring, codes only, or no
   account check at all, which keeps `sciex_companion_missing` for an account
   named `sciex` but loses the defence in depth.
7. *Answered on 2026-10-31 ([owner decision](#owner-decision-2026-10-31)):*
   **A failed conversion's outcome in the ring (decision 5).** Added after
   A0063. As recommended: yes, the report's `detailedOutcome` (its `outcome` when
   it has none) joins the ring when a conversion that ran ends in failure,
   recorded where the report is projected, after PR #161 merges, because that
   projection is #161's code. It is an owned id, so it adds no text, and
   decision 2 now says that the ring will name conversion outcomes too. The
   alternatives were the `Ok`-carried refusals as well, or the ring as it is,
   with decision 5 saying what it leaves out.
8. *Answered on 2026-11-03 ([owner decision](#owner-decision-2026-11-03)):*
   **The sentence of decision 10.** Added on 2026-11-03. Decision 10, accepted
   on 2026-10-30, lists one sentence saying that nothing was sent and that the user
   should read the text before sharing. Question 4 as A0063 showed it to the owner
   lists a Settings button, a read-only preview and the text clipboard, and no
   sentence. The rule of 2026-10-28 removes secondary explanations and keeps
   "recovery paths, no-overwrite and irreversible-action warnings, the
   scientific-honesty statements and accessible names", which does not say whether
   this reminder stays. As recommended: left out, as built. The text is in front
   of the user before anything is copied, and it holds no backend text. The
   conversion failure export keeps a sentence like it ("Review the file before
   sharing", ADR 0017), but that file holds redacted backend text the user has not
   seen when saving it. The alternative was one line beside the preview, in en and
   zh-CN.
   *Note, 2026-11-03:* "no backend text" here means none beyond the three identity
   tokens the Context lists (the release, the build date and the source revision).
