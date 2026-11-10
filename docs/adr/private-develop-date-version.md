# ADR: Independent date versions for private develop installers

- Status: Accepted for private develop only
- Date: 2026-11-10
- Related: release runbook, E2E-private-develop-version

## Context

Private Windows installers need a version independent of main's release number.
Bumping every source package would repeatedly conflict with upstream merges and
would make SSH bootstrap request private versions that have no published Host
bundle. Renaming only the installer would leave the application reporting the
upstream version.

## Decision

The private Windows packaging entry point reserves `YYYY.M.D-dev.N` in the
persistent release directory using the Asia/Shanghai date. It uses atomic
directory creation and advances past existing numbers, including failed builds.
Windows numeric file/product versions use `YYYY.M.D.N`.

The builder stamps the packaged manifest with that version and records the
upstream version and Git commit. Desktop obtains its installed version from
Electron's package metadata; unpackaged development uses shared `APP_VERSION`.
Remote Host release matching and source manifests keep the upstream baseline.

Keep the existing `net.aiuo.pi-desktop` application ID, `PI-Desktop` name,
installed `~/.pi-desktop` data directory, profile selection and update opt-out.
There is no data migration, new update feed, tag or remote publication.

## Consequences

Installers can be identified and ordered independently of main. Removing all
output directories loses the local numbering history; changing computers does
not transfer that history automatically. A failed build leaves a number gap.
Returning to an upstream `0.x` build compares as a downgrade.

`build-info.json` retains the source provenance. Unit/contract tests cover
reservation, builder metadata, version IPC and feedback. The packaged boot
probe compares renderer-visible version IPC with Electron's manifest version.
