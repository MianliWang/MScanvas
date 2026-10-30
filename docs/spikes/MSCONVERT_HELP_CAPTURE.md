# msconvert 3.0.26013 help capture

Status: **evidence, captured 2026-10-28.** The full `msconvert --help` output of
the build M6.2 measured, kept byte for byte so the
[option inventory](MSCONVERT_OPTION_INVENTORY.md) and
[ADR 0055](../architecture/adr/0055-msconvert-parity-verified-defaults-and-unverified-advanced-set.md)
can cite it line by line.

## Identity

| Fact | Value |
| --- | --- |
| File | [`evidence/msconvert-3.0.26013-help.txt`](evidence/msconvert-3.0.26013-help.txt) |
| Bytes | `34,486` (614 lines, every one ending in CRLF; 80 end in a space) |
| **SHA-256** | **`2597C0A4E81B0E26AA0FA71C943370A29277EA341C7E6BC495BD8B4160465752`** |
| Build footer, as printed | `ProteoWizard release: 3.0.26013 (47b13cf)` / `Build date: Jan 13 2026 14:42:37` |
| Installation | `%LOCALAPPDATA%\Apps\ProteoWizard 3.0.26013.47b13cf 64-bit` |
| `msconvert.exe` | reported at capture as `9BB6F5D5…`, the prefix of the digest [M6.2](M6_MSCONVERT_CAPABILITY_EVIDENCE.md#measured-proteowizard-build) records in full |
| stderr | 2 bytes (one CRLF) |

The digest is identical to the stdout digest M6.2 recorded for its own
`msconvert --help` capture
([complete help capture](M6_MSCONVERT_CAPABILITY_EVIDENCE.md#complete-help-capture)),
so this is the same text M6.2 read, now in the repository rather than only
described by it.

## How it was captured

```text
msconvert.exe --help   (run from the installation directory above)
stdout -> one file, stderr -> another; not through a pipe
```

Captured with the owner's consent as a bounded release of the ProteoWizard hold
for the help text only. No conversion ran and no other executable was started.
The exit status was not recorded.

## Why the file is stored byte-exact

The digest is over the bytes as the build wrote them, CRLF line endings and
trailing spaces included. `.gitattributes` marks this one path `-text
-whitespace`, so Git neither normalizes its line endings to LF (the repository
default) nor reports its trailing spaces as whitespace errors, and
`.editorconfig` tells editors not to rewrite it. Check it with:

```text
git ls-files --eol docs/spikes/evidence/msconvert-3.0.26013-help.txt   -> i/crlf w/crlf attr/-text
sha256sum docs/spikes/evidence/msconvert-3.0.26013-help.txt            -> 2597c0a4…5752
```

## What it is evidence of

That this build **accepts these spellings**, and what it **says** they do.
Nothing more. M6.2's rule stands: help text is not evidence that an operation
happens as described, and two of this text's own `[default]` markers were
measured to be incomplete
([M6.2](M6_MSCONVERT_CAPABILITY_EVIDENCE.md#evidence-is-bound-to-an-executable-not-to-a-help-text)).
