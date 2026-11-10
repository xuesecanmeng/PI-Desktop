# ADR: Inherit the computer proxy for private develop commands

- Status: Accepted for private develop only
- Date: 2026-11-10
- Related: ADR 0177, D340, E2E-private-command-proxy

## Context

The private Desktop installation must let workspace commands use the proxy
environment inherited from the computer. The shared Host transport strips all
proxy variables, which also removes the user's existing, unauthenticated local
proxy. Removing that filter would instead inherit mutable app proxy settings
after a Host restart.

## Decision

Desktop captures its startup proxy environment once, before applying app proxy
settings, and explicitly restores that snapshot when launching each Host.
PowerShell, cmd and Bash descendants inherit it without a new setting or switch.
The same snapshot restores Electron's System-mode environment.

App Custom/Direct changes do not change workspace command routing. Desktop
removes `PI_DESKTOP_PROXY_JSON` from the Host environment. The shared transport's
default filtering and the headless `pi-host` behavior remain unchanged.

## Consequences

User-provided proxy credentials, if present in the startup environment, are
visible to workspace commands just as in a normal inherited shell environment.
App-managed proxy credentials and relay tokens are not added to that environment.
This explicitly amends ADR 0177's blanket Desktop command isolation locally.

Environment changes require restarting Desktop from a parent that has the new
environment. This does not translate Windows system/PAC settings to environment
variables or configure Docker daemons and containers.

## Validation

`PI_DESKTOP_HOST_BIN=<built-host> node scripts/e2e-command-proxy.mjs` exercises
the production Desktop transport, real Host runner, selected shell and curl with
loopback proxy/origin fixtures. It checks startup inheritance, Host restarts
after app environment changes, bypass routing, and absence of app credentials
when no startup proxy exists. No provider or public network requests are needed.
