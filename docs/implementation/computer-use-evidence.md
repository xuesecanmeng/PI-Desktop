# Computer Use Stage 1 Evidence

What was built for [ADR 0342](../adr/0342-os-computer-use-capability.md) stage 1
and [ADR 0344](../adr/0344-computer-use-whole-desktop-grant.md), and — more
importantly — what has *not* been verified. This file contains no window titles,
no captured pixels, and no credentials.

**Integration safety hold:** Host-core currently selects an unsupported
backend on every platform. The macOS backend is retained but is not active;
per-step approval and revocation must be enforced and tested before re-enabling.

## Shape

| Layer | Where | State |
|---|---|---|
| Contracts, settings, error codes | `packages/shared/src/computer-use.ts`, `errors.ts`, `protocol.ts` | Implemented, unit-covered |
| Refusals, grant broker, desktop scope and binding | `crates/host-core/src/computer/` | Implemented, unit-covered |
| macOS backend (`AXUIElement`, `CGWindowList`, `CGEventPostToPid`) | `crates/host-core/src/computer/macos/` (`mod.rs` behaviour, `ffi.rs` C surface) | Retained but disabled; no device run |
| Windows and Linux backends | `crates/host-core/src/computer/backend.rs` | Explicit unsupported backend; stage 2 |
| `computer.*` RPC, Stop cooldown, audit | `crates/host-core/src/rpc/computer_rpc.rs` | Implemented, not covered by an RPC-level test (the cooldown rule itself is, as `policy::agent_mint_allowed`) |
| Bounded loop, action schema, window switch | `packages/computer-use/` | Implemented, unit-covered |
| `Computer` tool, automatic grant, capture, overlay driver | `apps/desktop/electron/main/computer-use/` | Implemented, refusal and mint paths unit-covered |
| Tool declaration and host gate | `packages/agent-runtime/src/computer-use/tool.ts`, `packages/host-runtime/src/agent-sidecar.ts` | Implemented |
| Indicator with Stop, settings, drawn cursor | `apps/desktop/src/features/computer-use/`, `features/settings/computer-use/` | Implemented, **not exercised by a UI test** |
| Target picker and grant card | — | Removed by ADR 0344; the renderer can no longer enumerate windows or mint a grant |

## Upstream stage 1 checks

| Check | Result |
|---|---|
| `cargo test -p host-core --locked` | 1160 passed, 1 ignored |
| `cargo clippy -p host-core --all-targets` | No new warnings (one pre-existing in `transcripts.rs`) |
| `cargo fmt -p host-core -- --check` | Clean |
| `pnpm build:js` | Passed |
| `pnpm --filter @pi-desktop/shared test` | 1378 passed (6 new) |
| `pnpm --filter @pi-desktop/computer-use test` | 27 passed |
| `pnpm --filter @pi-desktop/i18n test` | 31 passed |
| `pnpm --filter @pi-desktop/desktop typecheck` | Clean |
| `pnpm docs:check` / `check-locales` | The original branch reported a duplicate ADR identifier, resolved separately |

## What did not run, and what that means

- **No real application was ever driven.** No `AXUIElement` action, no
  `CGEventPostToPid` key, no `desktopCapturer` frame, and no macOS
  Accessibility prompt was triggered on this machine. The macOS backend is
  compiled and its pure parts (element id round-trip, chord table, action
  mapping) are unit-tested; everything that touches a live window is unproven.
- **Windows and Linux have no backend yet.** They compile to the unsupported
  backend, so every operation there answers
  `COMPUTER_PLATFORM_UNSUPPORTED` rather than failing oddly. Stage 2 adds UIA
  and AT-SPI with their own dependency review and device matrix.
- **No UI test covers the indicator, its Stop, or the drawn cursor.**
  Repository policy reserves `verify:ui:*` for an explicit request, and the
  `E2E-COMPUTER-USE-*` scenarios are `NOT RUN`. In particular, Stop aborting
  the owning turn has only been reasoned about, not clicked.
- **`confirm-each` has no approval card and never did.** It stays in the
  settings contract, is no longer offered in Settings, and selecting it through
  a settings write narrows nothing today. ADR 0342 described a per-step card
  that stage 1 did not build; ADR 0344 names the gap instead of implying it is
  closed.
- **The automatic grant and window switching are fixture-covered only.** The
  frontmost-usable bind, every rebind refusal, the closed-window fallback, and
  the Stop cooldown are unit tests against the fake backend. Whether the real
  macOS enumeration is actually ordered front-to-back — which is what "the
  frontmost usable window" relies on — is unverified on a device.
- **No provider call was made.** The loop's model request is covered by
  injected, scripted answers only; no computer-use model was configured and no
  token was spent.
- **The audit trail was not inspected in a running app.** The append calls are
  in place and shaped to carry identity without content, but no log file was
  read back to confirm that.

## Residual risk and re-enablement

The upstream macOS backend is not selected while the safety hold is active.
The existing `confirm-each` grant does not yet obtain per-step approval, and
disabling the setting does not yet revoke a live grant. Both behaviors require
implementation and regression coverage before native control is re-enabled.
No real macOS application was driven as part of this integration.
