# ADR: Direct local file access for desktop user actions

- Status: Accepted
- Date: 2026-10-23
- Related: [ADR 0262](0262-chat-file-refs-open-in-the-file-view.md),
  [file-opening destinations](configurable-file-opening.md),
  [ADR 0328](0328-browser-arbitrary-local-files.md)

## Context

A user clicking an existing handoff file outside the project receives an
outside-allowed-roots notice. Removing that check from chat completion alone
does not work: preview reads, directory listing and native destinations also
apply project/store containment. The requested desktop behavior is direct local
file access without directory grants or additional confirmation.

## Decision

Local desktop user file actions resolve actual paths without a project/store
allowlist. Absolute paths, local file URLs, home paths and workspace-relative
paths (including parent paths) can address any existing local file or directory
the operating system permits. Directory links may cross project boundaries.
Preview size/type limits, actual file/directory validation, failure reporting,
and fixed path-only native destinations remain in place.

Electron uses explicit user-file helpers for chat completion, preview reads,
image reads, directory listing, system opening, reveal and VS Code opening.
Known project/scratch/attachment matches retain their identity and shorthand
priority. Other exact user paths return `root: "external"`, an empty
`relativePath` and the absolute path. They use the host viewer, without granting
a plugin a new filesystem scope. Worktree references still prefer the session's
branch copy. No setting, persisted grant, or data migration is introduced.

Scoped resolver/read/list helpers retain canonical containment for remote Host,
agent and plugin consumers. A remote workspace never falls back to arbitrary
files on this computer. General external-URL allowlisting is unchanged.

## Alternatives

Per-file confirmation or adding external roots to project settings would keep
the unwanted interception. Globally removing containment from shared helpers
would also change remote and plugin contracts. Separate caller-owned policy
keeps those contracts while reusing preview classification and listing logic.

## Consequences

Local chat file links can open files outside a project without approval. This
also means a model-produced local path can name such a file when the user opens
it; external image references use the same local preview policy. OS access
errors and missing files still fail visibly. Remote and plugin scope regression
tests and an isolated Electron user path cover the distinction.
