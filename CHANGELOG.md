# Changelog

All notable changes to Koinkat are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

Initial public release candidate (0.1.0).

### Added
- Bank linking via Enable Banking (PSD2): user-supplied application ID
  and RS256 private key, with Koinkat's shared callback page pre-filled
  as the redirect URL (editable for self-hosters). Resilient sync that
  survives banks rejecting the transaction-status filter, PSD2 rate
  limits, and pending-to-booked transaction transitions.
- Review inbox with learning categorization (user rules, learned rules,
  MCC fallback), split-expense tracking with reimbursements, recurring
  expense detection, monthly budgets with per-month overrides and one-off
  events, yearly summary and category analysis with drill-down.
- Multi-currency accounts with decimal-exact money math (big.js), daily
  FX rates from a public CDN, privacy mode, JSON and raw-database export.
- Multi-workspace isolation: every workspace has its own accounts,
  categories, budgets, rules, and bank connections.
- The Enable Banking private key is stored in the OS credential store
  (Windows Credential Manager / macOS Keychain / Linux secret service)
  with a local-database fallback; legacy database-stored keys migrate to
  the keychain automatically on first read.
- Adopted the GPL-3.0-or-later license (full text in LICENSE).

### Security
- Production builds exclude all mock/debug code (enforced by a
  post-bundle scanner), ship without webview devtools, and restrict
  network access to the Enable Banking API and the exchange-rate CDN via
  CSP. OAuth deep-link callbacks are CSRF-validated. See SECURITY.md for
  the vulnerability disclosure policy and the README for the full
  security model.
