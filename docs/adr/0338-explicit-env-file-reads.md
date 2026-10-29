# ADR 0338: Allow explicit environment file reads

- Status: Accepted
- Date: 2026-10-29

## Context

The agent `Read` tool rejects `.env` and `.env.*` even when the user wants the
agent to inspect those files. This also rejects test configurations without
credentials. Shell commands are already outside this filename filter.

## Decision

Allow explicit `Read` calls for `.env` and `.env.*`. Other denied paths,
including private-key suffixes and `.git/objects`, remain protected. Existing
outside-workspace permission decisions continue to apply. Environment files
remain denied for `Write` and `Edit`, and remain hidden from `Glob` and `Grep`
except for the existing documentation templates. Plugin filesystem rules do
not change.

## Consequences

An explicit read can put credentials in the session and model context without
an additional prompt for files in the workspace. A remote model provider may
receive that content. Users must trust the agent and provider with any files
they ask the agent to read. No stored data format or tool schema changes.

## Alternatives

Keep the hard denial and ask users to use a shell or a sanitized template:
rejected because the requested workflow requires a direct file-tool read.
Introduce a per-file approval flow: rejected for this change because the
requested behavior is direct access using the existing permission modes.
