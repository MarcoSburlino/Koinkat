# Security Policy

## Reporting a vulnerability

Please report vulnerabilities **privately** via
[GitHub Security Advisories](https://github.com/MarcoSburlino/Koinkat/security/advisories/new)
("Report a vulnerability"). Do not open a public issue for security reports.

Include what you can: affected version or commit, reproduction steps, and
impact. You should get an initial response within 7 days.

## Coordinated disclosure

Please allow up to **90 days** from the initial report for a fix to ship
before disclosing publicly. If a fix lands sooner, disclosure can happen
sooner - coordinated through the advisory thread.

## Supported versions

Koinkat is pre-1.0; only the **latest released 0.x version** receives
security fixes.

| Version | Supported |
|---|---|
| latest 0.x | yes |
| anything older | no |

## Scope notes

Koinkat is a local-first desktop app with no server component. Reports
about the following are especially relevant:

- Leakage of the Enable Banking private key or bank data (logs, exports,
  network requests beyond the documented allowlist)
- OAuth / deep-link callback handling (`koinkat://auth-callback`)
- SQL injection or workspace-isolation bypasses in the local database layer
- Mock/debug code reachable in production builds

Physical or same-OS-user access to an unlocked machine is outside the
threat model (see the Security model section of the README).
