# Changelog

All notable changes to Koinkat are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.1] - 2026-08-03

### Added
- macOS builds are signed with an Apple Developer ID certificate and
  notarized by Apple, so the "damaged and can't be opened" dialog no
  longer appears.
- macOS builds are universal and run on Intel Macs as well as Apple
  Silicon. 0.1.0 was Apple Silicon only.

### Changed
- The app's typefaces (DM Sans, DM Serif Display, JetBrains Mono; all
  SIL OFL 1.1) are now bundled instead of loaded from Google Fonts, so
  launching Koinkat no longer contacts any font host and works fully
  offline; the content-security policy no longer allows the Google
  Fonts domains.
- Refreshed the app icon set.

### Fixed
- Corrected the Enable Banking setup guidance in the README and the
  in-app guide: restricted-mode activation covers only the accounts you
  link in the Control Panel, with a matching troubleshooting entry for
  the empty-account-list case.
- Grouped budget writes now run as single atomic SQLite batches, immune
  to pool-connection recycling dropping a transaction mid-flight
  ("cannot commit - no transaction is active"); database-plugin errors
  now surface their real message, and a failed budget deletion shows
  its reason in the dialog instead of failing silently.

## [0.1.0] - 2026-07-14

Initial public release.

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
- The Dashboard banner shown for sandbox workspaces can be dismissed for
  the current session.
- Adopted the GPL-3.0-or-later license (full text in LICENSE).

### Security
- Production builds exclude all mock/debug code (enforced by a
  post-bundle scanner), ship without webview devtools, and restrict
  network access to the Enable Banking API and the exchange-rate CDN via
  CSP. OAuth deep-link callbacks are CSRF-validated. See SECURITY.md for
  the vulnerability disclosure policy and the README for the full
  security model.
