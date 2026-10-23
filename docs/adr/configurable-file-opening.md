# ADR: Configurable file opening and explicit directory links

- Status: Implemented candidate
- Date: 2026-10-22
- Related: [ADR 0262](0262-chat-file-refs-open-in-the-file-view.md),
  [ADR 0109](0109-open-files-with-the-os-associated-application.md)

## Context

Chat file references always used an in-app destination. Users also need their
system applications and explicit editor/file-manager actions. Explicit Windows
directory links lost their href during Markdown sanitization, and the file-only
resolver could not complete them even if they reached Main.

## Decision

The [local user-file amendment](user-local-file-access.md) removes project/store
containment for local desktop user actions. Remote and plugin scopes stay separate.

- Settings → AI → Defaults has one `fileOpenTarget` preference for files,
  including HTML, and directories: `workpanel` or `external`. Missing or unknown
  stored values keep built-in viewing; invalid writes are rejected in renderer
  and Main. Existing host-owned JSON settings and configuration synchronization
  carry this optional field without a database migration. The candidate's former
  `htmlOpenTarget` field is ignored. HTTP(S) links retain their own preference.
- Transcript entry points share the resolved-file opener. Built-in viewing uses
  project File Manager (including HTML source), scratch/attachment/external host viewer,
  and source-line navigation. HTML no longer automatically opens the browser.
  Its existing Open with submenu still offers File Manager, built-in browser
  and default browser as single-click overrides. System opening uses `fs/open`;
  generic OS associations do not support source-line navigation.
- Every local file-reference menu keeps both path-copy actions and adds Open in
  VS Code and Open in File Explorer. Both resolve the reference before acting,
  ignore the saved destination for that click, and report failures. Remote
  workspace references retain copy actions without local application actions.
  The HTML submenu is added only after Main confirms an existing regular HTML
  file. Directories (including names ending in `.html`/`.htm` and directory
  aliases), missing files and unresolved references keep the generic actions.
  Generic actions appear immediately; late metadata cannot restore a dismissed
  menu, alter a newer request or cross a session/project change, and enrichment
  preserves keyboard focus.
- Add desktop-only `fs/openInVSCode({path, sessionId?})`. Main applies the same
  canonical file/directory validation and remote-session gate as `fs/open` and
  `fs/reveal`, then constructs a fixed `vscode://file` URI. Callers cannot supply
  an executable, scheme, URL, or arguments. URI encoding preserves Unicode and
  reserved filename characters. A directory URI ends in `/`. This follows the
  [documented VS Code file/folder URL format](https://code.visualstudio.com/docs/configure/command-line#_opening-vs-code-with-urls).
  The general external-URL allowlist remains unchanged.
- `fs/reveal` selects a regular file in the system file manager; for a directory
  it opens its contents. Existing files and directories only; missing paths,
  unsupported kinds and remote paths are rejected. Local external paths and
  links across project boundaries are accepted without extra confirmation.
- Explicit Markdown links admit directory paths. Plain prose and automatic
  file recognition stay conservative. Windows paths and local file URLs become
  encoded path references before sanitization; they never become unrestricted
  native URL navigation.
- `fs/resolveRef` adds optional `allowDirectories: boolean`, default false.
  Opted-in exact matches may return `isDirectory: true`; fuzzy matching and
  attachment hashes remain file-only. The owning session's worktree rebasing
  also covers directories. Exact local user paths need no project containment.
- Built-in directory browsing reuses the host Files tab and its directory tree.
  It expands child directories and routes file clicks through the same opener.
  Absolute `fs/list` requests can name any local directory; relative paths use
  the workspace as their base. Ignore rules remain, and valid child links may
  cross project boundaries. No vendored File Manager changes are needed.
- `fs/open` accepts local files and directories through `shell.openPath`.
  Attachment MP4 association and remote restrictions remain unchanged. The
  Plugin SDK's regular-file-only `fs.openDefault` contract is unchanged.

## Consequences

Users choose one destination for all files and folders. HTML browser preview
remains available explicitly. A directory named `outputs.html` is still a
directory: its resolved kind controls the action, and browser execution is
refused. Directory tabs retain their own requests across session changes.
Missing, stale-session and failed OS requests open nothing and
remain observable. VS Code must be installed with its URI handler registered.
No process ownership, persisted grant or plugin sandbox boundary changes.

## Alternatives

Patching the vendored plugin would create a local fork and depend on installed
marketplace versions. Reusing the host directory tree avoids that fork. Sending
raw custom URLs through the generic external opener would weaken its allowlist.
The dedicated path-only VS Code action instead owns a single fixed scheme after
the existing filesystem gate, without depending on a shell or a PATH command.
