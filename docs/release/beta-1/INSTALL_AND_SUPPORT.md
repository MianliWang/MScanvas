# MSCanvas beta 1 — install and support

Status: guide for the `v0.1.0-beta.1` prerelease, published 2026-10-28. The
[installed check](INSTALLED_CHECK.md) of this installer,
in a maintainer's administrator account, confirmed a silent install, a launch
of the installed program with ProteoWizard found, the interface language kept
across a restart, and uninstall through the program's own uninstaller. It did
not exercise the installer's own pages and language prompt, the WebView2
download, the **Not found** and **Found but not usable** banners, uninstall
started from **Installed apps**, **Delete the application data**, or a
standard-user account. What beta 1 does and does not do is in the
[release notes](RELEASE_NOTES.md).

## Before you install

- **Windows 11 25H2 x64.** That is the support target. Other Windows versions
  and ARM64 are not promised supported.
- **No administrator rights needed.** The installer installs for your user
  account only.
- **Microsoft Edge WebView2 Runtime.** Most Windows 11 installations already
  have it. If yours does not, the installer downloads it, which needs the
  Internet.
- **ProteoWizard**, for reading mzML runs, conversion and figure export. It is
  not part of MSCanvas: you install and license it yourself, and MSCanvas never
  downloads, installs or bundles it. Without it you can still add mzML files,
  group them and organise the workspace.
- **Keep the installer you download.** Rolling back means reinstalling one you
  kept.

## Download and verify

1. Download the installer from the beta-1 prerelease on the repository's
   GitHub Releases page,
   <https://github.com/MianliWang/MScanvas/releases/tag/v0.1.0-beta.1>. The
   file is `MSCanvas_0.1.0_x64-setup.exe`. Download it only from there.
2. Check its SHA-256 against the value in the
   [release notes](RELEASE_NOTES.md#candidate-identity). In PowerShell, in the
   folder that holds the download (for example, after
   `cd $env:USERPROFILE\Downloads`):

   ```powershell
   Get-FileHash .\MSCanvas_0.1.0_x64-setup.exe -Algorithm SHA256
   ```

   PowerShell prints the hash in capital letters and the release notes give it
   in lower case. Compare the characters, not their case.

3. Optionally, check where it was built. Each candidate is built on a
   GitHub-hosted runner and carries a build-provenance attestation that ties
   the installer's bytes to the repository commit and workflow run that built
   it. With the GitHub CLI installed and signed in (`gh auth login`), in the
   same folder:

   ```powershell
   gh attestation verify .\MSCanvas_0.1.0_x64-setup.exe --repo MianliWang/MScanvas
   ```

   An error asking you to sign in is not a failed verification.

If the hash differs or the attestation does not verify, do not run the file.
Report it privately, not in a public issue, through GitHub's private
vulnerability reporting:
<https://github.com/MianliWang/MScanvas/security/advisories/new>.

**Beta 1 is not code-signed.** Windows shows it as coming from an unknown
publisher. Started from File Explorer, SmartScreen is expected to warn with
"Windows protected your PC"; if the SHA-256 matched, you can choose **More
info**, then **Run anyway**. Started another way, for example with
PowerShell's `Start-Process`, Windows may instead show **Open File - Security
Warning**, naming an unknown publisher, with **Run** and **Cancel**; if the
SHA-256 matched, you can choose **Run**. What a browser shows when you download
the file was not checked for beta 1. Nothing here asks you to turn a
protection off or to override your organisation's policy: if your
organisation blocks unsigned software, this beta is not for that machine.

## Install

1. Close MSCanvas if an earlier copy is running. Run the installer. It asks for
   its language, English or Simplified Chinese, unless an earlier installation
   on this account recorded one.
2. It shows its licence (Apache-2.0) and the folder it installs into,
   `%LOCALAPPDATA%\MSCanvas` unless you change it. It installs for the current
   user only, without an administrator prompt, and adds an **MSCanvas**
   shortcut to the Start menu.
3. If WebView2 is missing, the installer fetches it. If that fails, install the
   Microsoft Edge WebView2 Runtime from Microsoft and run the installer again. A
   machine with neither WebView2 nor Internet access cannot complete a first
   installation.
4. Its last page offers **Create desktop shortcut** and to start MSCanvas, both
   selected unless you clear them.

## First run

1. Start MSCanvas from the Start menu.
2. MSCanvas looks for ProteoWizard where its installer puts it and on `PATH`,
   and shows what it found in a banner.
   - **Found and usable:** the banner names the build and folds away into the
     header.
   - **Not found:** install ProteoWizard and press **Check again**, or press
     **Choose folder…** and pick the folder that holds `msconvert.exe` and
     `msaccess.exe`. A folder you choose lasts for this session only; the next
     start searches automatically again.
   - **Found but not usable:** the banner says why, and offers **Check again**,
     **Search automatically** and **Choose a different folder…**.

   **Setting up ProteoWizard**, inside the banner, explains each control
   without a network connection.
3. Choose the interface language and row spacing in **Settings**. MSCanvas
   remembers them across restarts.
4. Add mzML files with **Add files…**, a folder, or a drop from Explorer, or add
   vendor files to convert. The [release notes](RELEASE_NOTES.md#known-limits)
   list what each part does not yet do.

## What MSCanvas writes, and where

| What | Where |
| --- | --- |
| The application | `%LOCALAPPDATA%\MSCanvas`, or the folder you chose, with a shortcut in the Start menu and, unless you cleared **Create desktop shortcut**, on the Desktop |
| Interface preferences | `%LOCALAPPDATA%\org.mscanvas.desktop\ui-preferences.json`. It holds the language, the row spacing and the panel choices, and nothing about your data |
| WebView2 data | `%LOCALAPPDATA%\org.mscanvas.desktop\EBWebView`, the embedded browser engine's own cache and settings |
| Install record | The registry key `HKCU\Software\MSCanvas contributors\MSCanvas`, holding the install folder and, after an interactive install, the installer's language, and the entry in **Installed apps**. A later install offers that folder and uses that language |
| Converted mzML | The destination folder you choose. An existing file is never overwritten. While converting, MSCanvas works in a folder there whose name ends in `.mscanvas-staging`; an interrupted conversion can leave it behind, and it can be cleaned up only in the session that made it (see the [known limits](RELEASE_NOTES.md#known-limits)) |
| Exported figures and data | Where you save them in the save dialog |
| Conversion diagnostics | Where you save them in the save dialog |
| Projects | The `.mscanvas` file you save, and a `<name>.mscanvas.payloads` folder beside it when the project holds stored results |

MSCanvas never modifies, moves or deletes your source acquisitions. Removing a
file from the workspace removes the row, not the file.

## Uninstall

Save any project you want to keep, let running conversions finish, then close
MSCanvas. If it is still running, the uninstaller and the installer stop with
"MSCanvas is running! Click OK to kill it": **OK** ends MSCanvas at once and
unsaved work is lost; **Cancel** lets you close it yourself and try again.

Open **Settings → Apps → Installed apps**, choose **MSCanvas**, then
**Uninstall**. Uninstalling removes the application's own files. It does not
remove your source acquisitions, converted outputs, exported figures and data,
saved diagnostics, project files or their payload folders: anything whose
location you chose stays where it is. The installed check found the sources and
outputs it had used unchanged after uninstall.

The uninstaller uses the language recorded at install, and asks for one only
when none was recorded, for example after a silent install. It then offers
**Delete the application data** (**删除应用程序数据** in Chinese), which is
**not** selected by default. Left unselected, these stay on your computer after
uninstall, and are still there if you install again:

- `%LOCALAPPDATA%\org.mscanvas.desktop`, with your interface preferences and
  the WebView2 data;
- the registry key `HKCU\Software\MSCanvas contributors`.

Beta 1 was not checked with **Delete the application data** selected. To remove
both by hand after uninstalling, in PowerShell:

```powershell
Remove-Item -Recurse "$env:LOCALAPPDATA\org.mscanvas.desktop"
Remove-Item -Recurse 'HKCU:\Software\MSCanvas contributors'
```

## Roll back

Close MSCanvas first, as in [Uninstall](#uninstall), then uninstall the current
beta and run the earlier installer you kept, after checking its SHA-256 again.
Beta 1 is the first release, so there is no earlier one to return to, and no
compatibility between betas is promised.

> **Corrected 2026-10-30.** The last sentence above is withdrawn for projects.
> Publishing beta 1 began a compatibility promise for its project documents
> (schema 4), as the [M9 closure](../../product/M9_CLOSURE.md#4-schema-4--the-canonical-disposition)
> says, and the owner kept that promise on 2026-10-30. The next version opens
> beta-1 projects. Once a project is saved in the next version, beta 1 can no
> longer open it, and reinstalling beta 1 does not undo that. To be able to go
> back, keep a copy of the `.mscanvas` file before saving it in the next
> version.

## Report a problem

Open an issue at <https://github.com/MianliWang/MScanvas/issues/new/choose> and
choose a template:

- **Bug report:** what you could not do and whether data or output was at risk,
  the steps, what you expected, and your environment.
- **Feature proposal:** the job you are trying to do and where the current
  workflow gets in the way.
- **UX research finding:** an observed usability problem, without personal
  identifiers.

Blank issues are turned off. A security problem, such as path traversal, a
change to source data, or an installer whose hash or attestation does not
match, is reported privately instead of in a public issue, as the
[security policy](../../../SECURITY.md) describes.

For the environment, give:

- the MSCanvas version, as shown under **Settings → Apps → Installed apps**, or
  the prerelease you downloaded;
- the Windows edition, version and build, which `winver` shows;
- the ProteoWizard build the banner names;
- the input format: mzML, Thermo RAW, Shimadzu LCD or SCIEX WIFF.

Issues are public. Do not attach acquisition files, proprietary data, or sample,
patient or personal identifiers, and blank out paths and names in screenshots.

## Attach conversion diagnostics

When conversion items fail and have diagnostics worth keeping, the conversion
results offer **Export failure diagnostics…** (Chinese interface:
**导出失败诊断…**). It saves one JSON file on your computer, through a save
dialog; nothing is sent anywhere.

The file has known filesystem paths and internal identifiers removed, but text
from ProteoWizard is reproduced as ProteoWizard wrote it, and an instrument's
metadata can name a sample, a study or a person. Before attaching it:

1. Open it in a text editor and read it.
2. Remove anything you cannot share publicly.
3. Attach the file to your issue, and say that you edited it if you did.

Beta 1 has no other diagnostics export. For a viewer, figure or project
problem, describe the steps and attach screenshots.
