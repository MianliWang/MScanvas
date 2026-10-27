# MSCanvas beta 1 — install and support

Status: **DRAFT; NOT RELEASED.** Download links, the installer name, its
SHA-256 and the signer are placeholders, filled at candidate acceptance. No
beta-1 installer had been installed or qualified when this was written; steps
that depend on installed behaviour say so. What beta 1 does and does not do is
in the [release notes](RELEASE_NOTES.md).

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
   GitHub Releases page: _link filled at candidate acceptance_. Download it only
   from there.
2. Check its SHA-256 against the value in the
   [release notes](RELEASE_NOTES.md#candidate-identity). In PowerShell:

   ```powershell
   Get-FileHash .\<installer>.exe -Algorithm SHA256
   ```

3. Check its signature: right-click the file, choose **Properties**, then
   **Digital Signatures**. The signer must be _filled at candidate acceptance_.
   In PowerShell, `Get-AuthenticodeSignature .\<installer>.exe` should report
   `Valid` and the same signer.

If the hash differs, the signature is missing or invalid, or it names anyone
else, do not run the file. Report it privately through the
[security policy](../../../SECURITY.md).

A correctly signed installer can still show a SmartScreen warning, because a
new signature has no reputation yet. Nothing here asks you to turn a protection
off or to override your organisation's policy. If your policy blocks the
installer, this beta is not for that machine.

## Install

1. Run the installer. It asks for its language, English or Simplified Chinese.
2. It installs for the current user only, into your per-user application folder
   under `%LOCALAPPDATA%`, without an administrator prompt.
3. If WebView2 is missing, the installer fetches it. If that fails, install the
   Microsoft Edge WebView2 Runtime from Microsoft and run the installer again. A
   machine with neither WebView2 nor Internet access cannot complete a first
   installation.

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
| The application | Your per-user application folder under `%LOCALAPPDATA%` |
| Interface preferences | `ui-preferences.json` in MSCanvas's per-user application data folder. It holds the language, the row spacing and the panel choices, and nothing about your data |
| Converted mzML | The destination folder you choose. An existing file is never overwritten |
| Exported figures and data | Where you save them in the save dialog |
| Conversion diagnostics | Where you save them in the save dialog |
| Projects | The `.mscanvas` file you save, and a `<name>.mscanvas.payloads` folder beside it when the project holds stored results |

MSCanvas never modifies, moves or deletes your source acquisitions. Removing a
file from the workspace removes the row, not the file.

## Uninstall

Open **Settings → Apps → Installed apps**, choose **MSCanvas**, then
**Uninstall**. Uninstalling removes the application's own files. It does not
remove your source acquisitions, converted outputs, exported figures and data,
saved diagnostics, project files or their payload folders: anything whose
location you chose stays where it is.

What happens to the interface preference file at uninstall: _recorded from the
installed candidate at acceptance_.

## Roll back

Uninstall the current beta, then run the earlier installer you kept, after
checking its SHA-256 again. Beta 1 is the first release, so there is no earlier
one to return to, and no compatibility between betas is promised.

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
change to source data, or an installer whose hash or signature does not match,
goes through the [security policy](../../../SECURITY.md) instead of a public
issue.

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
