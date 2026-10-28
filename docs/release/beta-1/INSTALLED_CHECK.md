# Beta 1 — installed check on the owner's account

Status: **one installed run on a development host, 2026-10-28.** Installed
steps 09:26–09:53 UTC (the first retained evidence is from 09:32); the
exported-numerics comparison was finished offline, its output last written at
10:03 UTC, and a scan-table reading of the same fixture followed, its summary
last written at 10:28 UTC (see item 5).

The run follows the owner's decision of 2026-10-28,
[installed check without a clean guest](../../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#owner-decisions-2026-10-28):
no virtual machine is available, so the check runs in the owner's own Windows
account on the development machine, per-user, with the ProteoWizard already
installed there, ends with an uninstall that records what remains, and is
recorded as that, not as the clean standard-user qualification of the
[release exits](../../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#release-exits-and-existing-residuals)
and the [M7.6 record](../../ux/M7_6_INSTALLER_RELEASE_INTEGRATION.md#acceptance).
The lack of a clean-machine installation is one of the
[accepted beta-1 gaps](RELEASE_NOTES.md#how-beta-1-was-checked). The decision
says "without administrator rights"; the account is a member of Administrators
with a UAC-filtered token (the group deny-only, medium integrity), and no
elevation was used. The owner approved the per-user install, Start-menu entry,
writes under `%LOCALAPPDATA%`, real conversions of existing fixtures with the
installed ProteoWizard, and uninstall. The evidence is about the real installer
and the real installed executable; it does not transfer to a rebuilt installer.

## Environment

| Item | Value |
| --- | --- |
| Windows | Windows 11 Home China (`CoreCountrySpecific`), version 26H2, build 26300.9711, x64. The registry `ProductName` still reads "Windows 10"; the build number is the identity. The support target is 25H2, so this is **not** the support-target build |
| Display | One 3840 × 2160 display, 150 % scaling (`AppliedDPI` 144) |
| Account | The owner's own Windows account, a member of `BUILTIN\Administrators` running with a UAC-filtered token (the group is deny-only, medium integrity). **An administrator account, not a standard user.** No elevation prompt was raised or needed |
| Machine | The development host: Node, Rust, Git, pnpm, Docker and VS Code are installed and were running or present. **Not a clean machine** |
| WebView2 | Evergreen runtime 155.0.4283.62, already present and the only version on disk until 09:48:13Z, when Evergreen installed 156.0.4314.50 (EdgeUpdate `pv` now 156.0.4314.50). Every application launch (the last at 09:41:38Z) came before that, so the runs used 155; the last session was still open at the update. The Edge WebDriver 155 used here no longer matches the host's runtime. The missing and offline WebView2 paths were not reachable |
| ProteoWizard | 3.0.26013.47b13cf, 64-bit, installed per-user by the owner before this run at `%LOCALAPPDATA%\Apps\ProteoWizard 3.0.26013.47b13cf 64-bit`: the only installation on the host (none under Program Files, none on `PATH`), in a location MSCanvas's discovery searches. The folder the application resolved was not retained; the banner shows only the version |
| SmartScreen | Windows default (no `SmartScreenEnabled` override, no policy keys). Smart App Control off (`VerifiedAndReputablePolicyState` 0) |
| Pre-existing MSCanvas state | No MSCanvas install and no HKCU uninstall entry. `%LOCALAPPDATA%\org.mscanvas.desktop` existed from development runs (2,064 files, 138,091,588 bytes, only `EBWebView`, no `ui-preferences.json`). Nothing under `%APPDATA%` belonged to MSCanvas |

The pre-existing `%LOCALAPPDATA%\org.mscanvas.desktop` was copied with a
per-file SHA-256 manifest, then renamed aside so the installed application
started with no application data, as a tester's first run would. After the
uninstall it was renamed back and its manifest compared: 2,064 of 2,064 files
identical.

## Candidate

| Item | Value |
| --- | --- |
| Installer | `MSCanvas_0.1.0_x64-setup.exe`, 6,469,906 bytes, SHA-256 `4bf752addff63c489df440814efbd2adb9f445cb41ce406bdf6d9a035c657ee8` — matches the [release notes](RELEASE_NOTES.md#candidate-identity) and the candidate manifest |
| Provenance | `gh attestation verify … --repo MianliWang/MScanvas` exit 0: subject digest as above, SLSA provenance v1, source `e6d2a49e5061398c0ed2a374b2efa90d3d1c4c0e` on `refs/heads/main`, signer `release-candidate.yml@refs/heads/main`, `github-hosted` runner, run 40618719468 attempt 1 |
| Authenticode | Installer and installed executable: `NotSigned`, as the approved unsigned posture says |
| Pre-bundle executable (manifest) | 19,506,176 bytes, SHA-256 `bf75aa9ca2a1835d348174da6c43db89381bf3f703b5a968818065074df5b66f` |
| Installed executable | `mscanvas-desktop.exe`, 19,506,176 bytes, SHA-256 `9760e30a86a8b5c5fcc08153cefc53668f5f91cdedece0a596e9e92a981c11d4` |

The installed executable is not expected to hash to `bf75aa9c…`: the bundler
rewrites the `__TAURI_BUNDLE_TYPE_VAR_UNK` token to `NSS` while packaging, as
`scripts/verify_installed_payload.py` explains. The pre-bundle executable is not
part of the candidate artifact, so it was **reconstructed** from the installed
file by changing that one token back (offset 15,344,418; bytes 15,344,442–444).
The reconstruction hashes to `bf75aa9c…`, the digest the GitHub runner measured
into the manifest, and `verify_installed_payload.py --controls` then reports
`MATCH` with all five positive and negative controls passing. The installed
payload is therefore the manifest's executable plus exactly the bundler's
three-byte rewrite.

## Results

| # | Check | Result |
| --- | --- | --- |
| 1a | Unsigned trust behaviour (Mark-of-the-Web copy) | **PASS** |
| 1b | Per-user install, location, shortcuts, uninstall entry, payload | **PASS** |
| 2 | Installed launch: window, scaling, backend banner, bundled frontend, no QA markers | **PASS** |
| 3 | Preference lifetime across a restart (zh-CN, then back to English) | **PASS** |
| 4 | Complete supported task with real files | **PASS**, with Copy plot, Open file and Open folder **NOT RUN** |
| 5 | Exported numerics: CSV against the mzML's own decoded arrays, exact `f64` | **FAIL** |
| 6 | Recovery and refusals that were cheap to reach | **PASS** for the overwrite refusal and for Clear leaving files untouched; Clear's ended-queue flow **NOT CHECKED**; the rest **NOT RUN** |
| 7 | Uninstall (silent and interactive), leftovers, restore | **PASS**, with leftovers listed below |

### 1a. Unsigned trust behaviour

A copy of the installer was given a `Zone.Identifier` stream (`ZoneId=3`,
`HostUrl` the repository's releases page). The original installer had no
alternate data stream other than `:$DATA`.

- **Launched through Explorer** (`explorer.exe "<copy>"`), as a double-click
  would: Microsoft Defender SmartScreen showed **"Windows 已保护你的电脑"**
  ("Windows protected your PC"): "Microsoft Defender SmartScreen
  阻止了无法识别的应用启动。运行此应用可能会导致你的电脑存在风险。", with
  **更多信息** (More info) and **不运行** (Don't run). More info added
  "应用: MSCanvas_0.1.0_x64-setup.exe", "发行者: 发布者未知" (Publisher: Unknown
  publisher) and **仍要运行** (Run anyway). This is what
  [Install and support](INSTALL_AND_SUPPORT.md#download-and-verify) describes,
  in the host's Chinese UI. **Don't run** was pressed through UI Automation by
  its id (`dontRunBtn`) inside that window; no setup process started. Run anyway
  was not pressed.
- **Launched by `ShellExecute` from a non-Explorer process** (a PowerShell
  `Start-Process` wrapper): no SmartScreen window; instead the Attachment
  Manager's **"打开文件 - 安全警告"** (Open File — Security Warning) appeared:
  "无法验证发布者。你确定要运行此软件吗?", publisher "未知发布者", with Run and
  Cancel. Cancel was pressed by IDCANCEL inside that wrapper's dialog; no setup
  process started. Because the wrapper was hidden, its dialog was created
  hidden and was shown deliberately to capture it. What a browser's download
  shelf shows was not tested.
- Organisational policy blocking unsigned software: **NOT RUN**; no such policy
  exists on this host.

### 1b. Install

`MSCanvas_0.1.0_x64-setup.exe /S` from the original (no Mark-of-the-Web) file:
exit 0 within 1.5 s (`logs/install-process.txt`, by its start time and write
time). No elevation prompt: observed during the session, not retained.

| Item | Observed |
| --- | --- |
| Install location | `%LOCALAPPDATA%\MSCanvas\` holding `mscanvas-desktop.exe`, `uninstall.exe` (81,933 bytes), `LICENSE` and `THIRD_PARTY_NOTICES.md` |
| Shipped resources | `LICENSE` SHA-256 `c71d239d…0ab4` and `THIRD_PARTY_NOTICES.md` `86a3790e…8699`, both equal to the manifest's build inputs. The M7.6 record's "present after installation" row is established for this candidate |
| Start menu | `%APPDATA%\Microsoft\Windows\Start Menu\Programs\MSCanvas.lnk` → `%LOCALAPPDATA%\MSCanvas\mscanvas-desktop.exe` |
| Desktop | `Desktop\MSCanvas.lnk`, same target. A silent install (`/S`, without `/NS` or `/UPDATE`) creates it; the interactive installer's **Create desktop shortcut** option was not exercised. Install and support did not mention it when the check ran; it now does |
| Uninstall entry | `HKCU\…\Uninstall\MSCanvas`: DisplayName `MSCanvas`, DisplayVersion `0.1.0`, Publisher `MSCanvas contributors`, InstallLocation and UninstallString under `%LOCALAPPDATA%\MSCanvas`, NoModify/NoRepair 1, EstimatedSize 19150, links to the repository. No `QuietUninstallString`. The snapshots retain the key only; the values were observed during the session, not retained |
| Other registry | `HKCU\Software\MSCanvas contributors\MSCanvas`, default value = the install folder |

`/S` skips the installer's language selector, so the install-time "asks for its
language" step was not exercised. The uninstaller showed it (see 7), defaulting
to 中文(简体) on this host.

### 2. Installed launch

- **Start-menu launch** (the shortcut, through the shell): one
  `mscanvas-desktop.exe` from the install path, window "MSCanvas" 2182 × 1406
  physical pixels (1455 × 937 at 150 %), header chip **ProteoWizard ready**,
  empty roster (`shots/02-startmenu-first-run.png`). Observed during the
  session, not retained: no TCP connection owned by the application or by the
  six WebView2 processes created at or after its launch (selected by creation
  time, not by parent) at the sampled moment; nothing listening on port 1420;
  a `conhost.exe` child; closed with `WM_CLOSE` on that process, after which
  every process exited.
- **WebDriver attached to the installed executable**: `tauri-driver` with Edge
  WebDriver 155 on ports 15620/15621. In the page, observed during the session,
  not retained: `location` is `http://tauri.localhost/`; the only resources are
  `assets/index-BixDYNVf.js` and `assets/index-tOgbBjKb.css` — the names of the
  manifest's frontend build outputs — plus `ipc.localhost` command calls; no
  `127.0.0.1:1420` request. None of the five rendered-QA boundary globals
  (`__mscanvasBoundary__`, `__mscanvasConsole__`, `__mscanvasIpcCalls__`,
  `__mscanvasIpcSeed__`, `__mscanvasIpcTable__`) exists. `devicePixelRatio`
  1.5, viewport 1440 × 900, `lang` `en`. The WebDriver screenshots are
  2,160 × 1,350 pixels, consistent with that viewport and ratio.
- Banner, expanded: "ProteoWizard is available — 3.0.26013 · built Jan 13 2026
  14:42:37" (`shots/03-banner-expanded.png`).

Scope: "no development server contacted" rests on the page's resource list and a
TCP sample, both unretained, not on a packet capture. The forged-IPC refusal
and runtime capability enforcement were not tested.

### 3. Preference lifetime

Settings → 简体中文 previewed the interface in Chinese at once; **应用** (Apply)
wrote `%LOCALAPPDATA%\org.mscanvas.desktop\ui-preferences.json`, 130 bytes:
`{"schemaVersion":1,"appearance":{"locale":"zh-CN","density":"comfortable"},"layout":{"roster":"automatic","details":"automatic"}}`.
The application was then **closed with `WM_CLOSE` on its window** (not a
WebDriver session delete), and a new session started the installed executable
again: it opened in zh-CN (`lang` `zh-CN`, header 工作台 / 转换与结果 / 项目 …
/ ProteoWizard 就绪). Switching back to English wrote `"locale":"en"`. The file
holds no path, roster or scientific state. Corrupt, unsupported-version,
oversized, unreadable and write-failure recovery were not tested here.

### 4. Complete supported task

The fixtures were copied into the campaign directory and used from there:
Thermo `FT-HCD-MSX.raw` (78,309 bytes, `b3d97b38…dd7b`) and
`FT-HCD-MSX-0.mzML` (28,616 bytes, `a1228c10…5ea7`). Every native dialog was
driven by the repository's helpers in `e2e/native/`, bound to the application's
process id. Two helper runs went wrong, both in this run's harness: the first
RAW picker helper never started (its path was not quoted, `pwsh` exit 64) while
the application's picker was already open, and a second invocation then found
and drove that same picker; and the first Quick PNG helper reported
`found: false` (see the harness note below). Every other helper reported
`found` and `invoked` (`logs/dialog-*.out`), and every saved file is in
`logs/outputs.txt`. The application's own "Saved …" status after each save was
observed during the session, not retained.

| Step | Result |
| --- | --- |
| Add files… → RAW, then mzML, through the native picker | PASS: two rows, "Thermo RAW 76.5 KiB" and "mzML 27.9 KiB" |
| Preview the mzML | PASS: chromatogram (one MS2 scan at RT 1601.2900), spectrum 0 "MS2, 1,504 points", 483 sticks drawn, m/z 70.0292–1430.7953 |
| Export PNG… / SVG… / CSV… through the native save dialog | PASS: PNG 18,271 bytes, IHDR 1,200 × 640, `pHYs` 300 DPI; SVG 42,548 bytes; CSV 40,572 bytes, 1,504 records. Status "Saved spectrum-0.png with 1,504 points, 1,200 by 640 pixels, Light theme, 300 DPI." observed, not retained |
| Quick PNG (header quick path) | PASS: `dialog-quickpng2.out` found and drove the PNG save picker; `spectrum-0-quick.png` is byte-identical to the Export PNG… file (`a260491b…`, same settings). That the full Export figure dialog did not open was observed, not retained; no screenshot shows the quick path |
| Copy plot | NOT RUN: it would overwrite the owner's clipboard |
| Convert the RAW, custom folder | PASS: Convert → native folder dialog "Choose where to save the converted mzML" → campaign folder; "1 converted, 0 skipped, 0 failed of 1", 27.9 KiB, 1 spectra, 1 chromatograms, 909.0 ms. Output `FT-HCD-MSX.mzML`, 28,582 bytes, `b931ab42…f224` |
| Add converted output to workspace, preview it | PASS: third row added; "Viewing: FT-HCD-MSX.mzML", spectrum 0 MS2 1,504 points |
| Open file / Open folder | NOT RUN: each opens a window in another application that this run could not attribute and close safely |
| Source bytes afterwards | PASS: the campaign copies and the original fixtures still hash `b3d97b38…dd7b` and `a1228c10…5ea7` |

Harness note: the first Quick PNG attempt clicked a hidden copy of the button
while the Export spectrum disclosure was open, and no dialog appeared. With the
disclosure closed the visible button worked. Not counted against the product.
`shots/11-quickpng-after.png` was taken between the two attempts and is
byte-identical to `10-overwrite-refused.png`; it is not evidence that Quick PNG
succeeded.

### 5. Exported numerics

`compare_csv_numerics.py` decodes spectrum index 0 of the source mzML with
Python's `base64`, `zlib` and `struct` (m/z 64-bit float, intensity 32-bit
float, zlib, 1,504 values each, widened to `f64`) and compares each CSV record
by exact `f64` equality.

- Lengths agree: 1,504 records, 1,504 + 1,504 values.
- **1,499 of 1,504 records differ.** Every CSV value equals the decoded value
  **rounded to 8 decimal places** (1,504 of 1,504). Largest relative difference
  6.75 × 10⁻¹¹. Example: m/z `70.02922821` against `70.02922821044922`;
  intensity `12398.22949219` against `12398.2294921875`.

The CSV writer documents that it writes "exactly the `f64` the backend parsed"
(`apps/desktop/src-tauri/src/preview/export.rs`), so the rounding happens
before the writer. The source shows where: a selected spectrum is read with
`msaccess -x "binary index=<n> precision=<p>"`, and the application fixes
`SELECTED_SPECTRUM_PRECISION: u8 = 8`
(`apps/desktop/src-tauri/src/preview/backend.rs`), so ProteoWizard formats each
value to 8 decimal places and MSCanvas parses that text. That command was not
run separately in this check; the attribution is from the source plus the
8-decimal match above. At the time of the check the
[release notes](RELEASE_NOTES.md#csv-and-tsv-files) said "MSCanvas writes
exported values exactly as they are stored", and for this file that was not
true; they now state the rounding. Whether the read path changes as well is an
owner decision. See [Defects](#defects).

The chromatogram's source values were read separately, after the installed
run: `msaccess -x "spectrum_table delimiter=tab"`, the operation MSCanvas uses
for its scan table (`crates/proteowizard/src/command.rs`), was run with the
installed ProteoWizard 3.0.26013.47b13cf on a scratch copy of
`fixtures/FT-HCD-MSX-0.mzML` (copy and fixture both `a1228c10…5ea7`;
`logs/scan-table-rounding.txt`, `logs/scan-table-rounding.spectrum_table.tsv`).
No recorded approval covers this read: the owner's approval for this check
names conversions of existing fixtures with the installed ProteoWizard, and the
[2026-10-20 bounded release](../../development/POST_PM9_NATIVE_QUALIFICATION.md#provider-hold)
covers only the native qualification. It is put to the owner to confirm. The
scan stored at scan start time 26.688152 min (1601.28912 s) is
printed as `rt 1601.29`, the retention time the preview showed (item 4), and
base peak m/z 86.0967517 as `86.0968`. TIC `136441170.00` and base peak
intensity `9890852.00` equal the stored values. No chromatogram export was
compared value by value.

### 6. Recovery and refusals

| Check | Result |
| --- | --- |
| Export to an existing file name | PASS: CSV to `spectrum-0.csv` again → "A file of that name already exists. MSCanvas did not replace it. Choose another name."; the file's SHA-256 was unchanged; no overwrite prompt appeared |
| Clear list with rows, after the queue had ended ("results retained") — files on disk | PASS: "Cleared 3 files from the list. The files on disk were not changed."; sources and outputs hashed unchanged afterwards |
| Same action — flow | NOT CHECKED against the specification: it cleared at once, with no choice dialog. The M7.4 Clear choices are specified for an active run; whether a retained, ended queue should also offer one was not confirmed here |
| Clear choices with an active run, stop/completion races, quarantine | NOT RUN: not cheap |
| G18 installed fault (stranded staging cleanup/replan) | NOT RUN: needs an induced fault |
| Missing backend | NOT RUN: would require hiding the owner's ProteoWizard installation |
| PNG picker cancel, DPI refusal, write failure | NOT RUN |

### 7. Uninstall

Two uninstalls were run.

1. **Silent:** `uninstall.exe /S`, exit 0. Then a silent reinstall from the same
   installer to check reinstall and the interactive path (exit 0 and the same
   executable hash observed during the session, not retained). The application
   was not launched after the reinstall.
2. **Interactive:** `uninstall.exe` started directly (the uninstall entry's
   UninstallString; it was not launched through Settings → Apps). It copied
   itself to `%TEMP%\~nsu5.tmp\Un.exe`, asked for a language (English / 中文(简体),
   default 中文(简体)), then showed "卸载 MSCanvas" with the folder
   `C:\Users\<user>\AppData\Local\MSCanvas\` and a **删除应用程序数据** (Delete
   the application data) checkbox, **unchecked by default**. It was left unchecked;
   卸载(U) → "卸载完成 / 卸载程序成功完成卸载。" → 关闭(L).

After each uninstall:

| Item | After uninstall |
| --- | --- |
| `%LOCALAPPDATA%\MSCanvas\` | Removed |
| Start-menu and Desktop shortcuts | Removed |
| `HKCU\…\Uninstall\MSCanvas` | Removed |
| `HKCU\Software\MSCanvas contributors\MSCanvas` | **Remains**, default value = the old install folder |
| `%LOCALAPPDATA%\org.mscanvas.desktop\` | **Remains**: `ui-preferences.json` plus the WebView2 user-data folder `EBWebView` (163 files, 9,374,642 bytes); 164 files, 9,374,769 bytes in all |
| `%TEMP%\~nsu5.tmp\Un.exe` | **Remains** after the interactive uninstall (81,933 bytes, the uninstaller's own copy). Not checked whether it is scheduled for deletion at reboot |
| Campaign outputs (figures, CSV, converted mzML) | Remain, hashes unchanged |
| Source fixtures | Unchanged |
| `CHXSmartScreen.exe` | **Still running**: PID 3040, started 09:35:28Z by `svchost.exe` (PID 1200) during step 1a. Not stopped |

The preference file also outlived both uninstalls and the reinstall: it still
held `"locale":"en"`, last written at 09:41:49Z. The application was not
launched after the reinstall, so whether a reinstalled application restores
the setting was not observed. The observed answer to what happens to the
interface preference file at uninstall, which
[Install and support](INSTALL_AND_SUPPORT.md#uninstall) now states, is that
**it is kept** by the silent uninstall and by the interactive one with Delete
the application data left unchecked. The checked path was not exercised.

The application data the installed runs wrote was moved into the campaign
directory as evidence, and the pre-existing folder was restored exactly.

## Defects

| Severity | Finding | Evidence |
| --- | --- | --- |
| Numeric (release claim corrected) | Spectrum CSV values are the source's decoded values rounded to 8 decimal places, not the stored `f64`, because the spectrum is read through `msaccess binary … precision=8` (`SELECTED_SPECTRUM_PRECISION`). At the time of the check the release notes said values are written "exactly as they are stored"; they now state the rounding. The CSV writer's own contract (exact backend-parsed `f64`) is not contradicted. The scan table that feeds chromatogram exports prints rounded retention times too. Needs an owner decision: change the read precision, or keep stating the rounding. The same read feeds the plots, but at 6.75 × 10⁻¹¹ relative that is far below drawing resolution | `logs/numerics.txt`, `logs/scan-table-rounding.txt`, `out/spectrum-0.csv`, `fixtures/FT-HCD-MSX-0.mzML` |
| Documentation (resolved) | When the check ran, Install and support did not mention the Desktop shortcut the installer creates, the registry key left at uninstall, or that application data is kept unless Delete the application data is checked. It now describes all three | Sections 1b and 7 |

## Differences from a clean standard-user qualification

- Development host, not a clean machine; administrator account (UAC-filtered),
  not a standard user; Windows 26H2 build 26300, not the 25H2 support target;
  the physical host, as the owner decided, since no virtual machine is
  available.
- WebView2 was already present, so the missing/offline paths were not reached.
- Install was silent; the install-time language selector and wizard pages were
  not exercised.
- Uninstall ran the UninstallString directly, not through Settings → Apps.
- The application was driven by WebDriver (`tauri-driver` + Edge WebDriver)
  for steps 3–6. A release build has no QA IPC boundary, so the flows were the
  real ones; activation by click (`m7.5-activate-window.ps1`) refuses any
  executable other than the repository's e2e build and was not used.
- The WebDriver sessions did not write the application's `EBWebView` (last
  write 09:39:12Z, before the first WebDriver launch at 09:40:31Z); Edge
  WebDriver probably gave WebView2 a temporary profile, and no `scoped_dir`
  created during the run was left in `%TEMP%`. The preference file is not in
  that profile: it was written to the real application-data folder (last at
  09:41:49Z).
- Unicode and spaced install paths, denied permissions, keyboard-only use,
  other viewports and reduced motion were not tested.

## ADR 0047 release exits and other beta-1 items

G18 is an ADR 0047
[residual](../../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#release-exits-and-existing-residuals),
not an exit; exported numerics comes from the
[after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md#1-beta-1-what-is-left-before-publication-phase-0).

| Item | What this run covers | What it does not |
| --- | --- | --- |
| Installable Windows x64 candidate | One real installer installs, launches and uninstalls per-user without elevation; payload identity proven; sources and finalized outputs survive uninstall | Standard user and clean machine (an accepted beta-1 gap), WebView2 missing/offline, Unicode/space paths, denied permissions |
| Production configuration | Build configuration: the candidate's `scripts/inspect_candidate.ps1` evidence (`package-inspection.json`): no QA marker in the pre-bundle executable `bf75aa9c…`, no development origin in the production CSP. Runtime: the installed application loaded the bundled frontend from `tauri.localhost`, with no dev-origin request and no QA boundary globals, observed during the session, not retained. Shipped frontend: the inspection's asset list names `index-gbwyn1IL.js` and `index-DMxk1d8J.css`, from the QA control step that rebuilt `dist` without the Tauri build environment (Vite target `safari13`), not the shipped `index-BixDYNVf.js` and `index-tOgbBjKb.css`. A later rebuild of `e6d2a49` with the Tauri hook's environment reproduced all three shipped frontend files byte for byte (the manifest's `frontendInputs`); they hold no `127.0.0.1:1420` or `localhost:1420`, and of the inspection's 11 QA marker needles only `qaRootUnbound`, `qaRootNotAbsolute` and `qaRootNotADirectory` occur, once each, as keys of the preference-error message table every build carries (`storageMessages.ts`) | A retained runtime record; a read-back of the frontend embedded in the installer; forged-IPC refusal, capability enforcement as executed, packet-level network observation |
| Safe preference lifetime | Locale persisted across an installed restart; the preference file was kept across uninstall and reinstall | A reinstalled application reading it (not launched after reinstall); corrupt/unsupported/oversized/unreadable/write-failure recovery, reset, changed-display projection |
| Complete supported task | Import, view, convert (custom folder), result, adopt, preview, figure and data export, source bytes unchanged | Open file / Open folder, missing/replaced output, handler failure, unsupported input, missing backend, stranded staging |
| Figure quick paths | Quick PNG through the picker, output identical to Export PNG…; not opening the full dialog observed, not retained | Copy plot, picker cancel, DPI refusal, write failure, preview/export agreement |
| Active workspace recovery | Clear list after a finished queue | Every Clear choice during a run, races, quarantine, stale import |
| G18 installed fault (ADR 0047 residual) | — | Not run |
| Exported numerics (after-beta-1 plan) | **FAIL**: spectrum 0 of one mzML, full range, CSV; see item 5 | TSV, chromatogram data export, current-range export, the converted `FT-HCD-MSX.mzML`, stored-result tables |
| Release custody, unsigned trust tests | Hash, attestation, SmartScreen through Explorer with Mark-of-the-Web, Attachment Manager prompt through `ShellExecute` | Organisational policy, a browser download |
| Offline, readable, accessible UI | zh-CN and en rendering of the main shell at 150 % | Keyboard, focus, aria/live-region audit, other viewports |

## Evidence

Local and not committed. Check an item before sharing it: the four snapshots
(`logs/snapshot-*.txt`) list the owner's Desktop files, Start-menu entries,
application-data folders, `%LOCALAPPDATA%\Programs` folders and HKCU
`Software` and Uninstall key names, together an inventory of the owner's
installed software; `appdata-backup/` is a copy of the pre-existing
`%LOCALAPPDATA%\org.mscanvas.desktop` (WebView2 user data from development
runs); and several shots and logs show the user-profile path with the account
name. Campaign directory
`D:\tmp\beta1-installed-20261028T093203Z\`:

- `shots/`: SmartScreen (`01b-smartscreen-initial.png`,
  `01d-smartscreen-more-info.png`), the Attachment Manager prompt
  (`01a-open-file-security-warning.png`), first run (`02-…`), zh-CN restart
  (`05-…`), preview, export, refusal, conversion and uninstaller pages.
  `11-quickpng-after.png` duplicates `10-…` (see item 4).
  `01c-screen-after-explorer-launch.png` is a full-screen capture
  (3840 × 2160) of the owner's screen: it stays local and must not be shared.
- `logs/`: attestation JSON, snapshots before install, after install, after
  uninstall and final; installed file hashes; `verify-installed-payload.txt`;
  `reconstruct.txt` and the reconstructed pre-bundle executable; UI Automation
  dumps of SmartScreen and the uninstaller; dialog-helper JSON for every
  dialog; `numerics.txt`; `scan-table-rounding.txt` and its `.tsv`; preference
  files; app-data manifests (original, backup, restored).
- `fixtures/`: the campaign copies of `FT-HCD-MSX.raw` and
  `FT-HCD-MSX-0.mzML` used in item 4; item 5's scan-table read used a scratch
  copy of the mzML.
- `motw/`: the installer copy with the `Zone.Identifier` stream used in item
  1a (same SHA-256 as the installer).
- `out/`: `spectrum-0.png`, `spectrum-0-quick.png`, `spectrum-0.svg`,
  `spectrum-0.csv`, `converted/FT-HCD-MSX.mzML`.
- `appdata-backup/`: the copy of the pre-existing application data.
- `appdata-after-uninstall/`: what the installed runs left in
  `%LOCALAPPDATA%\org.mscanvas.desktop`.

Scripts and the process ledger are under `.tmp/beta1-installed/` in the
repository (ignored). The frontend reproduction's scripts, hashes and scan are
in `D:\tmp\beta1-candidate-e6d2a49\frontend-repro\`.
