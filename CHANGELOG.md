# Changelog

All notable changes will be documented here once versioned releases begin.

## Unreleased

### Added

- **SCIEX WIFF conversion, through `Add files…`.** Select a `.wiff` and MSCanvas
  admits it together with the required `.wiff.scan` beside it as **one**
  workspace row — the companion is never a row of its own, and selecting both
  halves still gives you one acquisition. Recognition reads the measured
  structure inside the container and the companion's own leading bytes, never
  the file name alone; a `.wiff` holding another vendor's container is refused
  when it is added rather than after a converter has run. A missing, unreadable
  or wrong companion is refused with a sentence telling you which file to put
  beside it, and selecting a `.wiff.scan` on its own tells you to select the
  `.wiff` instead.

  **One acquisition is one queue item, whatever it produces.** A SCIEX
  acquisition can hold many samples and ProteoWizard writes one document per
  sample, choosing their names itself — so the plan reads *1–24 mzML outputs,
  filenames determined during conversion* rather than inventing a name, queue
  progress still counts acquisitions rather than output files, and a ten-sample
  acquisition offers **ten** outputs to add when it is over, not one. Each
  adopted output is an ordinary mzML row.

  For an acquisition that converted all of its outputs, MSCanvas says that
  *every sample identified by the SCIEX reader produced its output* — which does
  not claim the reader identified every sample in the acquisition, and claims
  nothing about fidelity. Validation stays output-only.

  Publishing several files is sequential and is **not** a transaction. If it
  stops partway, the files already written stay in your folder, MSCanvas says
  how many there were, and it will not present them as the acquisition's
  complete output set — you can add them individually later with `Add files…`.
  Such an item is not offered a retry, and is never described as though nothing
  had been converted.

  Folders and Explorer drops still discover mzML only — for this family most of
  all, since a `.wiff` is half an acquisition and pairing it with whatever sits
  beside it in a folder is a decision a traversal has no evidence to make. SCIEX
  rows still cannot be previewed directly: convert first, then add the outputs.

### Changed

- **A queue item now states what it will produce rather than naming one file.**
  Items whose output name is known before the run — Thermo and Shimadzu — are
  unchanged in meaning; items whose backend names its own outputs say so
  explicitly instead of carrying an empty name. The count of outputs offered
  after a queue finishes is now a count of output **files** rather than of
  finalized items, so a queue holding one Thermo row and one ten-sample SCIEX
  acquisition offers eleven.

- **Shimadzu LabSolutions LCD conversion.** `Add files…` now also admits the
  evidenced Shimadzu LabSolutions LCD family, and the serial conversion queue
  converts it — alone or mixed with Thermo Scientific RAW rows, in the order
  shown, each family gated on the exact ProteoWizard build evidenced for it.
  Recognition reads the measured structure inside the container, never the
  file name alone: a renamed or malformed compound file is refused when it is
  added, not after a converter has run. Folders and Explorer drops still
  discover mzML only, LCD rows cannot be previewed directly (convert first,
  then add the output), and a chromatogram-only acquisition converts to a
  successful mzML that says exactly that — 0 spectra and its chromatogram
  count. Validation remains output-only; nothing claims source fidelity.

- **`Export failure diagnostics…`**, for a conversion queue that has reached a
  terminal state and has something worth diagnosing. It saves one local JSON
  file, where you choose, describing the latest attempt of every diagnosable
  item: an ordinary failure, a stop that could not be confirmed, or an item that
  converted and left its staging area behind. A queue whose own stop failed is
  described too, for what the queue itself records. A queue that simply worked
  offers nothing at all.

  Each item carries structured facts — the display name, the planned output name,
  the attempt number, the boundary's own stable outcome and detail identifiers,
  validation properties, bounded process facts, cleanup residue — and, where a
  backend ran and failed, a bounded excerpt of what it printed on each stream.

  The excerpts are redacted where MSCanvas can be exact: the acquisition, the
  destination folder, the staging area, the converter executable and its
  installation, the temporary folder and the user profile, in every spelling
  Windows offers — case, separators, dot segments, extended-length and UNC
  prefixes, and short and long names. What survives that is then judged by shape,
  and an excerpt that still looks like it names an absolute local path is left
  out of the file entirely with a stable reason in its place.

  **This does not make the file anonymous.** Converter output is written by an
  instrument's software about a real acquisition and may still contain
  acquisition metadata. MSCanvas says so beside the action and again inside the
  file, and asks you to review it before sharing.

  Nothing is uploaded, mailed, posted or copied to the clipboard, no support site
  is opened, and the saved file is not opened for you. An existing file of the
  chosen name is never replaced — MSCanvas writes a private temporary file,
  forces it to disk, and gives it the name you chose only if nothing already has
  it. A refusal that leaves a temporary behind says so rather than hiding it.

  Bounded throughout: at most 32 KiB per stream after redaction, at most one
  diagnostic per queue item, and at most 2 MiB in the whole file. A document over
  that is refused and writes nothing rather than being cut in half.

  Session-only, like every other thing a queue holds. Only the latest attempt of
  each item is described, a retry that works takes the failure it replaced with
  it, and replacing the queue drops MSCanvas' memory of having exported — never
  the file, which is yours. There is no diagnostics history and no run log.

  It is refused while an adoption is under way and refuses one in return, because
  both read the same terminal result. It launches no process, so a session that
  has stopped trusting the backend can still use it — which is the session that
  most needs it.

- **`Add converted outputs to workspace`**, for a conversion queue that has
  reached a terminal state. It adds every finalized mzML output of that queue,
  in queue order, and only when the user asks: nothing is adopted because a
  conversion finished, and nothing is previewed as a result. MSCanvas admits an
  output only when the final name still refers to the exact object that queue
  finalized *and* that object still holds the byte length and digest the
  validation measured -- neither answer alone is enough, and the object those
  questions are asked of is the one the workspace is about to hold. An output
  that is missing, replaced, modified or no longer readable is reported as such
  and does not stop the others; one already in the workspace returns the row
  that is already there. Stopped and stop-failed queues keep whatever they
  finalized and can still be adopted, and so can a session that has stopped
  trusting the backend, because adding a file launches no process. Nothing is
  persisted: replace the queue or restart, and the outputs are ordinary mzML
  files that `Add files…` still reaches.

- **`Stop queue`**, for a conversion queue that is running. It asks the current
  conversion to stop, begins none of the items after it, and reaches one terminal
  state. Outputs already completed stay in the destination folder and no partial
  output is ever finalized; the partial document a terminated backend leaves is
  removed by the same object-bound cleanup a failed run uses.

  It is one queue-level action, not a per-item cancel, and it is deliberately not
  called *Cancel*: it ends the whole queue and undoes nothing already written. The
  panel says both halves before it is pressed. There is no confirmation dialog, no
  pause, no resume and still no percentage.

  Which items end how is decided by what the process boundary observed first. A
  conversion that completed before the request was accepted keeps its ordinary
  result rather than being relabelled `cancelled`; one still running when
  termination is confirmed becomes `cancelled` and produces no file. Items the
  queue never began are `not run` — neither failures nor attempts — and every
  count is reported separately.

  A stopped queue is terminal and is not rerun in place, so `Retry failed` is not
  offered for it; `Retry failed` is unchanged for a queue that ran to its own end.
  Converting those rows again is a new queue from the roster.

  If MSCanvas cannot confirm that the converter process tree ended, the queue ends
  as *stop could not be confirmed* rather than *stopped*, and the session refuses
  every further preview, spectrum load, conversion, retry and installation change
  until MSCanvas is restarted. The roster stays readable, searchable and sortable.
  Nothing invents a check the process boundary cannot support.

  A reload recovers a running, stopping or stopped queue, its per-item results and
  the quarantine, and may stop what it recovered; it never re-issues a stop or
  restarts an item. `stop_workspace_conversion_queue` is new and takes only the
  operation identifier plus proof of the calling document. The conversion state
  gains `stopping` and a terminal reason; queue items gain `cancelled`,
  `notRun` and `cancellationFailed`. Nothing on the wire names a location, a
  process or a handle.

- A serial conversion queue for selected Thermo Scientific RAW workspace rows.
  Select up to **16** of them and MSCanvas shows the ordered list it would run,
  the mzML name each item would write, and how many selected rows are excluded
  for being mzML already; two rows that would write one name are refused before
  anything is chosen or created. One Fail-or-Skip choice and one Rust-owned local
  destination picker settle the whole queue. Items convert one at a time, in the
  order shown, on one provider binding, and the panel says which item of how many
  is running — there is no percentage, and still no cancellation. One file's
  failure marks that file and the queue carries on; nothing already converted is
  undone. Each item reports its own outcome and the queue reports how many
  converted, were skipped and failed. `Retry N failed` reruns only the failures
  Rust explicitly classifies as retryable, in their original places, into the same
  folder under the same policy, leaving converted and skipped files alone. Every
  queued row stays visible through a search and cannot be removed until the queue
  ends. Nothing on the wire names a location.

  Replaces the single-conversion state machine rather than sitting beside it: one
  focused row is a queue of one. `begin_workspace_conversion` is now
  `begin_workspace_conversion_queue` and takes an ordered list of handles;
  `describe_workspace_conversion_queue` and `retry_workspace_conversion_queue`
  are new. The conversion state's `completed` and `failed` members are gone,
  folded into one `terminal` whose queue says which items did which.

- The first visible conversion: one focused Thermo Scientific RAW workspace row
  to mzML. `Add files…` now admits that one evidenced vendor family alongside
  `.mzML`, recognizing it by its file signature rather than its name; folder
  ingestion and Explorer drop remain mzML-only. Every roster row says which
  family it is, and a Thermo row cannot be previewed until it is converted.
  Focusing one shows a fixed plan — mzML output, zlib compression, and an
  explicit statement that validation is output-only — with a Fail-or-Skip choice
  and no overwrite. `Convert focused…` opens a Rust-owned picker for a folder on
  this computer; network and mapped locations are refused before anything is
  created. One conversion runs at a time, it cannot be cancelled and says so,
  and it survives a window reload. The result reports the output's name, size
  and record counts without ever naming a location, and the converted file is
  not added to the workspace for you.

- Windows Explorer drag-and-drop for one or many regular `.mzML` files, ordinary
  local folders, or a mixture of both. Direct files use the same acceptance
  boundary as `Add files…`; folders use the same recursive, deterministic and
  link-refusing discovery boundary as `Add mzML folder…`. One ordered drop obeys
  one root limit and shares entry, directory and candidate budgets; traversal
  depth restarts at zero for each folder. It reports incomplete input without
  discarding valid files already found and never starts one backend read per row.
  Native paths remain in Rust, a second active drop is rejected as busy, and
  directory-formatted or vendor acquisitions remain unsupported.
- Session mzML workspace. One or many local `.mzML` files can be chosen in a
  single native picker operation and appear as an ordered list, each held through
  a Rust-owned opaque handle. Adding the same acquisition again reports the row
  you already have; files that could not be read are named individually and leave
  the rest of the batch added. Rows can be selected with the pointer or the
  keyboard, removed, or cleared — none of which changes anything on disk. The
  session holds up to 1,024 files.
- Adding a folder of mzML files. `Add mzML folder…` scans one folder you choose
  and adds every regular `.mzML` file beneath it in a single operation, in a
  deterministic order, without launching any ProteoWizard process. On Windows,
  the Explorer-style folder picker accepts an absolute path pasted into its
  address bar. The scan stays inside the folder you chose: junctions, symbolic
  links, mount points and cloud
  placeholders are never followed, and are counted and reported instead of being
  silently skipped. Four named limits bound how deep, how wide and how far it
  goes, and a scan that reached one of them, refused a linked entry or could not
  read a subtree says so — "no mzML files were found in that folder" is said only
  by a scan that described the whole folder. The list stays usable while it runs;
  a selection you build meanwhile survives the scan and the new rows join it. If
  you picked the wrong folder, `Clear list` stays available even when the list is
  empty; when its command succeeds, the final workspace is empty.
  `Remove selected` also stays available to manage existing rows, but it is not
  cancellation: if the import commits first, its newly discovered rows can
  remain. In either order, a late folder reply cannot overwrite the later
  mutation's authoritative roster; if
  that mutation fails, a fresh roster read reconciles the workspace after both
  operations settle.
- Where a row was found, shown only when two rows in the session share a
  filename, and only for as long as they do. It is a fragment of where the file
  sat under the folder you chose, never an absolute path, never a drive and never
  the folder's own name; it is display only, so it changes neither what a search
  finds nor how the list is sorted, and it does not outlive the session.
- Workspace search and sort. The list can be narrowed by filename and ordered by
  the order files were added, by name in either direction, or by size in either
  direction; names with numbers in them sort the way they read, so `sample-2`
  comes before `sample-10`. A search never hides work in progress: a row you
  selected, the row whose preview is on screen and a row being read stay visible
  and say why. The count says how many files matched rather than how many rows
  are on screen, and a search that finds nothing says so rather than claiming the
  session is empty. Ranges, `Ctrl+A` and the keyboard follow what is on screen.
  None of it reaches the backend, and neither the search nor the sort outlives
  the session.
- Explicit, one-at-a-time reading. Moving around the workspace starts no backend
  work; previewing the focused file reads its acquisition metadata, run summary,
  virtualized spectrum table and, on selecting a row, one spectrum. Choosing ten
  files starts one read, not ten. The spectrum is drawn as a repository-owned SVG
  stick plot with no charting dependency.
- Session-only ProteoWizard installation-folder selection, alongside automatic
  discovery on `PATH` and in the locations an installer writes. The chosen
  folder applies to the current session only, is never written to disk, and
  returning to automatic discovery is offered from every state.
- A private mzML conversion boundary in the ProteoWizard adapter: one immutable
  plan, one staged execution, one no-clobber finalization. A source is opened and
  read as mzML before it becomes one, so a name or an extension is never taken
  for an acquisition. The backend writes into a private staging directory
  MSCanvas creates inside the destination root, and the final name is taken only
  after the produced document passes the integrity contract, by a move that fails
  rather than replaces. A failed, rejected or partial output is discarded, and
  the only way one is left beside the user's files is a cleanup failure, which is
  reported. The conflict policy is fail or skip;
  there is no overwrite to select. Cancellation is deliberately absent while real
  backend cancellation remains unmeasured. Nothing in the application reaches
  this: no command, transfer object, capability or frontend file changed. See
  [ADR 0009](docs/architecture/adr/0009-mzml-conversion-execution-boundary.md).
- Typed mzML conversion-integrity contracts in the ProteoWizard adapter. When the
  source is itself mzML, they compare acquisition facts captured before and after
  a conversion; a source in any other format cannot be captured that way, so no
  source-to-output fidelity claim is made for it. These are library contracts; no
  user-facing conversion workflow is built on them yet.
- Recorded navigation and scale evidence from a representative public
  open-format acquisition, used to accept the preview boundary with named
  limits.
- Initial repository bootstrap.
- Product and engineering source-of-truth proposal.
- React/Tauri application shell and Rust workspace skeleton.
- Product, UX, architecture, Codex and CI scaffolding.
- Canonical private GitHub repository metadata and initialization report.

### Changed

- The single-file picker was replaced by the workspace list. Choosing a file no
  longer discards the one before it; the list is what holds them and removing a
  row is what removes one.
- The mock acquisition list, mock conversion inspector, mock run queue and mock
  total ion chromatogram were removed rather than migrated. Everything the
  application displays now comes from the opened file.
- A preview is attributed to the ProteoWizard installation that actually
  resolved rather than the one that was requested, and a spectrum reconciled
  across an installation change is refused instead of shown beside a table the
  replaced installation produced.
- The 8 MiB preview-text ceiling now has a single authority shared by every
  caller instead of being restated per call site.

### Fixed

- Reading one file twice in quick succession no longer lets the older read
  decide what is on screen. A newer request for a file makes an older one stale,
  and a read the user has moved past says so instead of answering as though it
  were current.
- Automatic discovery now finds a ProteoWizard written by the per-user
  installer, and searches a newer release before an older one.
