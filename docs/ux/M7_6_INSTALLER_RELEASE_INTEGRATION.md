# M7.6 — Installer and release integration

Status: **implementation and preparation in progress; installed qualification
NOT started; no release-ready claim; nothing published as a binary.**

This slice does not add a user-visible feature. It turns the application M7.1 to
M7.5 built into something a person can install, run and remove on a machine that
has never seen a compiler, and it assembles the evidence a release would need.
Until the installed campaign in [Acceptance](#acceptance) runs, this record
describes a candidate, not a qualified one.

## The packaging route, and why each part was chosen

| Decision | Value | Why |
| --- | --- | --- |
| Installer | NSIS only | `bundle.targets` was `"all"`, which on Windows also emits a per-machine MSI. Shipping two installers with different privilege requirements, one of them contradicting the current-user route, is worse than shipping one |
| Install mode | `currentUser`, stated explicitly | It is the bundler's default, but a release path should not rest on a default that can change upstream. A per-user install needs no administrator and lands in `%LOCALAPPDATA%` |
| WebView2 | `embedBootstrapper` | Embeds the bootstrapper, ~1.8 MB, so the installer does not have to fetch it. It still **downloads the runtime itself** when one is missing, so a first installation on a machine with no WebView2 needs the Internet. See [Limits](#limits) |
| Languages | `English`, `SimpChinese`, with the selector shown | The pinned bundler already ships translations of its own installer messages for 22 languages including Simplified Chinese, so both are available without writing or translating anything |
| Signature | **none** | Owner decision. No certificate was bought, no key accessed, and no claim is made that an unsigned build avoids SmartScreen |
| Version | `0.1.0`, unchanged | Four sources carry it: the workspace `Cargo.toml`, the root and desktop `package.json`, and `tauri.conf.json`. Each crate inherits through `version.workspace` |
| Publisher, copyright, licence | From the workspace manifest and the repository `LICENSE` | `authors = ["MSCanvas contributors"]`, Apache-2.0. No company or certificate identity was invented |

### One inherited defect the first bundling build exposed

`bundle.category` had been `"Science"` since the repository's first commit and
was still `"Science"` at the M7.5 baseline. It is not one of the values the
bundler accepts, so the first build that actually constructed bundler settings
failed with `invalid category`. Nothing had caught it because the only build in
CI passes `--no-bundle`, which never constructs them.

It is now `Productivity`, the closest honest fit from the accepted list.
`Medical` was rejected deliberately: this is a research workbench, and that
category would imply a clinical claim the product does not make.

## What the installer carries

`LICENSE` and `THIRD_PARTY_NOTICES.md` are bundle resources.

Before this slice the installer carried only this project's own Apache-2.0
licence. The MIT, BSD, Zlib, BSL-1.0 and Apache-2.0 packages compiled into the
binary require their notices to accompany a binary distribution, so that was a
compliance gap rather than missing polish.

`scripts/generate_notices.py` regenerates the inventory from what actually
ships — the release binary's normal dependency edges for
`x86_64-pc-windows-msvc`, and the production frontend bundle — rather than from
`Cargo.lock`'s 504 entries, almost none of which reach a user. That is **260**
Rust and **66** frontend packages. It refuses to generate when a package
declares a licence term the inventory has no obligation text for, so a new
licence family stops the build instead of landing in a table unremarked.

Five MPL-2.0 crates arrive transitively through Tauri — four through its HTML
processing, one through its directory resolution. MPL-2.0 section 3.2 obliges us
to make their source available to whoever receives the binary, so the file names
each shipped version with a location that serves that source. Being unmodified
is recorded as an additional fact, not as a substitute for availability.

## Production configuration

`scripts/inspect_candidate.ps1` inspects the built bytes rather than the source's
intent. A `#[cfg(feature = "e2e")]` and an empty capability `permissions` array
say what we meant to build.

It searches the candidate for five strings that exist only because a QA-only
path was compiled in: the rendered-QA IPC interception table, its call log, its
pre-mount answer seed, its boundary handle, and the QA preference-root
environment variable. None is present.

Absence is the claim, so the scanner first proves it can find each marker, using
a QA build from an earlier milestone as a positive control. That control's
identity is recorded with the result, because "detectability proven" means
nothing without knowing what proved it. The scope of that claim is narrow: it
shows the scanner did not find **those five** markers. It is not proof that the
candidate carries no test capability, and it is not runtime acceptance.

### The development origin, stated precisely

`127.0.0.1:1420` **is present** in the executable, seven times, entirely inside
the embedded `tauri.conf.json` — the `devCsp` block and `devUrl`, adjacent to
`/dist` and `LICENSE`. `generate_context!` embeds the whole configuration, so a
release binary contains it as inert data.

A whole-binary search for that string therefore cannot distinguish "a
development build shipped" from "the configuration was embedded", and a check
that always fires reports nothing. The occurrences are retained rather than
removed, and no development configuration was deleted to make a string
disappear.

The two checks that can actually fail are that the dev origin reaches a shipped
frontend asset, or reaches the production CSP — the one a release build applies.
Both are clean, and both are proven able to fire against seeded input in the
same run. That control found a real defect in the checker itself:
`Select-String -SimpleMatch` treats its pattern literally, so a regex-escaped
needle matched nothing and would have reported any input clean.

**Not established by any of this:** that the installed application contacts no
development server, refuses a forged IPC call, or enforces capabilities as
executed. Those need runtime observation and belong to the installed campaign.

### Resource payload, attributed separately

| Claim | Status |
| --- | --- |
| Configuration declares the resources | established |
| The bundler staged them beside the executable | established |
| They are inside the installer payload | **not established** |
| They are present after installation | **not established** |

Size growth is not payload membership. A name search of the installer found
neither notices nor licence — but also did not find the application executable,
which certainly is in there, so NSIS compression makes it inconclusive in both
directions rather than negative. Payload membership is a guest read-back item.

## Support target

Windows 11 25H2 x64, unchanged from [ADR 0047](../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md).
Other Windows versions and ARM64 are not promised supported. A support target is
not evidence of compatibility and is not installation qualification.

## Acceptance

**Not started.** No candidate has been installed, launched or uninstalled
anywhere. The qualification environment exists and its constraints are recorded;
the campaign has not run.

Every mandatory release exit in ADR 0047 maps to a scenario that must be
exercised on the installed production application, by a standard user, on a
machine with no Node, Rust, Git or pnpm: installation lifecycle including
Unicode and spaced paths; the complete scientific workflow through import,
conversion, adoption, preview and export; recovery and destructive boundaries
including every active Clear choice and staging recovery; figure correctness;
preference lifetime across restart and corruption; bundled localisation,
keyboard and display coverage; and uninstall and reinstall with source and
finalized-output preservation proven by hash.

## Limits

These hold regardless of how the campaign turns out.

- **Edition.** Qualification will be on Windows 11 **Home**, which is what most
  of the stated audience and the development host run. One edition is not every
  edition.
- **Activation.** The qualification guest is installed without a product key and
  runs unactivated, which shows a desktop watermark and locks personalisation.
  No installer, application, conversion or uninstall path depends on those. No
  key, activation bypass or clock manipulation is used.
- **Execution engine.** The guest runs under VirtualBox's NEM path on the
  Windows Hypervisor Platform, because the host's hypervisor holds VT-x for
  WSL2 and VBS. VirtualBox labels this "snail execution mode". Functional
  conclusions do not change with it; any timing observation will carry the
  engine and host conditions that produced it.
- **Virtual, not physical.** A virtual machine is not a physical-device result.
  Pointer, touch, GPU and display behaviour observed there is virtual-device
  evidence and is recorded as such.
- **WebView2 offline.** `embedBootstrapper` embeds the bootstrapper, not the
  runtime. A machine that has no WebView2 and no Internet cannot complete a
  first installation. This is documented as a prerequisite with a recovery path,
  not worked around by silently substituting another runtime mode.
- **Unsigned.** Windows SmartScreen and organisational policy may warn or block.
  Observed behaviour is recorded as observed. No guidance is given for defeating
  an organisation's policy.

## Release packet

Prepared for a **possible** public GitHub prerelease for early testers. Nothing
here authorises a tag, a release, or a binary upload, and no draft release
exists.

### Setup

1. Windows 11 25H2 x64.
2. Run the installer. It installs for the current user only, into
   `%LOCALAPPDATA%`, and needs no administrator.
3. It is unsigned, so SmartScreen is expected to warn. Nothing here tells you to
   disable a protection or override your organisation's policy; if your policy
   blocks unsigned software, this beta is not for your machine.
4. WebView2: most Windows 11 installations already have it. If yours does not,
   the installer fetches it, which needs the Internet. If that fetch fails,
   install the Microsoft Edge WebView2 Runtime from Microsoft and run the
   installer again.
5. ProteoWizard is **not** bundled and never will be by this route. Conversion
   needs your own installation; the application finds it or asks you to point at
   it.

### Support and feedback

GitHub Issues on the repository, using the existing bug, feature and UX
templates. Nothing is uploaded automatically: the application sends no telemetry
and no report leaves your machine unless you attach it yourself.

### Sharing a diagnostics export

The conversion diagnostics export already removes known absolute filesystem
paths and internal identifiers before writing, and the file itself repeats the
warning the panel shows:

> Known filesystem paths and internal identifiers are removed, but backend text
> may still contain acquisition metadata. Review the file before sharing.

That warning is accurate and worth acting on. Backend text is reproduced from
ProteoWizard's own output, and an instrument's metadata can name a sample, a
study or a person. Read the file before attaching it to a public issue.

### Rollback

Uninstall through Windows Settings, then reinstall the previous installer you
kept. Uninstalling removes the application's own files; it does not remove your
acquisitions, your converted outputs, or anything else you chose the location
of. No compatibility with an older release is promised, because there is no
older release.

### Candidate identity

Filled in from the retained manifest at the point a candidate is proposed for
release. A rebuilt installer is a new candidate even when its code is unchanged,
and byte-specific acceptance never transfers between them.

## Name

The product name and the application identifier `org.mscanvas.desktop` are
**provisional**. A bounded review is recorded in the milestone evidence and
awaits the owner's actual acceptance; release-ready status is blocked until
then. Packaging and qualification are not blocked by it.

## Evidence

Local and ignored under `.tmp/m76-evidence/`: the candidate manifest and every
superseded candidate with the reason it was replaced, the build and inspection
logs including failed attempts, the package inspection with its controls, the
environment measurements and authorized package identities, the guest probe
finding, the supplied media identification, and the corrected name review with
its superseded version retained.
