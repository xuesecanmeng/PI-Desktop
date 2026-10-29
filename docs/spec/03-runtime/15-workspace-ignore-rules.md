# 15. Workspace Ignore Rules

## 1. Goal

Prevent tools from scanning/reading/writing sensitive or useless paths by
default, while allowing an explicit, visible permission decision when a task
intentionally targets a path outside the session workspace.

## 2. Rule layers (priority high → low)

1. **Security denylist** (always on, not user-disable in MVP)
2. **App defaults** (shipped)
3. **Workspace rules** (`.pi-desktopignore` at the workspace root)
4. **User global ignore** (`<data_dir>/ignore`, i.e. `~/.pi-desktop/ignore`
   by default)
5. Explicit tool path still subject to the security denylist and the
   outside-path permission gate

An explicit `path` argument on `Glob`/`Grep` opts that walk out of layers 2–4
(the same way it already bypasses parent `.gitignore` rules), so a caller who
names `node_modules/pkg` or `dist` can still search it. Layer 1 applies to
every walk and every explicit path.

## 3. Security denylist (always)

Outside-workspace read/write/search is denied by default. An explicit
`Read`/`Glob`/`Grep`/`Write`/`Edit` path may proceed only after the host applies
the permission mode: `auto` allows it, while `ask` and `accept-edits` ask the
user. An implicit recursive walk never gains outside-workspace access.

Also deny inside workspace (and inside the scratch or an approved external
root) for:
- `.git/objects/**`
- private key patterns: `*.pem`, `*.key`, `id_rsa`, `id_ed25519`
- credential files: `*.p12`, `*.pfx`, `credentials.json` (Google)

`.env` and `.env.*` are allowed for explicit `Read` calls. They remain denied
for `Write` and `Edit`, and are hidden from `Glob` and `Grep`, except for the
documentation variants ending in `.example`, `.sample`, or `.template`. Other
denylist rules still apply to explicit reads, including protected suffixes and
`.git/objects/**`. Plugin filesystem access follows its own policy.

File-name matching is case-insensitive. `Glob` and `Grep` drop matching files
from their results silently; an explicit `Read`, `Write`, or `Edit` (including
the `Edit` move destination) of a path denied for that tool fails with
`WORKSPACE_PATH_DENIED`, and an outside-path grant does not lift that denial.
`Bash` is not filtered (§6). See ADR 0338 for the disclosure trade-off.

## 4. Default ignore (app)

```gitignore
.git/
node_modules/
dist/
build/
.target/
target/
.venv/
venv/
__pycache__/
.pytest_cache/
.mypy_cache/
.DS_Store
*.log
coverage/
.turbo/
.next/
.cache/
```

## 5. Workspace file

Support:

```text
.pi-desktopignore
```

Syntax: gitignore-compatible subset.

## 6. Tool behavior

| tool | ignore application |
|---|---|
| Glob | unscoped walk: layers 1–4 filter results; explicit `path`: layer 1 only |
| Grep | unscoped walk: layers 1–4 filter the file set (in-process walker and the system `rg` fast path alike); explicit `path`: layer 1 only |
| Read | `.env` and `.env.*` are allowed unless another denylist rule applies; otherwise `WORKSPACE_PATH_DENIED` on a denylisted file; outside paths remain permission-gated |
| Write/Edit | `WORKSPACE_PATH_DENIED` on a denylisted file or move destination; otherwise permission-gated when the explicit path is outside; `TOOL_DENIED` after denial |
| Bash | path sandbox still enforced by host; ignore file does not expand bash powers |

## 7. Diagnostics

Tools should return stable errors:
- `PATH_OUTSIDE_WORKSPACE` — path escapes the workspace root before an
  outside-path permission decision
- `TOOL_DENIED` — outside-path permission was denied, timed out, or cancelled
- `WORKSPACE_PATH_DENIED` — an explicit path hit the security denylist (see
  [08-error-codes §3.3](08-error-codes.md))

UI can show “hidden by ignore rules” counts for Glob/Grep optionally later.

## 8. Acceptance criteria

- [x] outside paths require permission in non-auto modes and are allowed in Auto
- [x] default ignores hide node_modules from Glob/Grep
- [x] workspace ignore file honored
- [x] security denylist cannot be disabled from UI in MVP
