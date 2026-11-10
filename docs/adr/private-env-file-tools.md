# ADR: Treat environment files as ordinary built-in tool files

- Status: Accepted for private develop only
- Date: 2026-11-10
- Supersedes: [Explicit environment file reads](explicit-env-file-reads.md)

## Context

The explicit-read exception leaves agent tasks unable to create or edit
`.env` and `.env.test` through built-in file tools. It also makes environment
files readable by name but undiscoverable through search. The user requested
ordinary file handling for all environment-file variants on local `develop`.

## Decision

Remove environment-file name rules from the built-in security denylist.
`Read`, `Write`, `Edit`, `Glob`, and `Grep` apply their normal policies to
`.env` and `.env.*`, without special template exceptions. Keep private-key
and credential-bundle rules, `.git/objects` protection, path containment,
permission modes, and Plan/Goal tool restrictions. An environment-like name
with a protected suffix, such as `.env.private.key`, remains protected.

Ordinary search ignores still apply: a user can exclude environment files
in `.gitignore`, `.pi-desktopignore`, or the global ignore file. Plugin
filesystem permissions remain independent and unchanged.

## Consequences

Searches can now disclose environment-file names and contents to the agent
and its model provider. Approved file-tool edits can change credentials or
runtime configuration. Existing approval and edit-consistency checks apply;
no extra environment-file approval or persisted-data migration is introduced.

## Alternatives

Keep read-only access: rejected because it leaves the requested edit workflow
blocked. Add a separate per-file permission setting: rejected because the
requested behavior is ordinary file access under existing permissions.
