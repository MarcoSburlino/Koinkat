# Changelog

All notable changes to Koinkat are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.2] - 2026-08-28

Mostly the outcome of a legal and compliance review. The user-visible
changes are corrected wording and one bug fix; the substantive change is
that the licences of the bundled code and typefaces now travel with the
installer, which they previously did not.

### Added
- `THIRD-PARTY-LICENSES.md` covering every shipped npm package and Rust
  crate, generated from the lockfiles and bundled inside the installer.
  Settings gains a "Third-party licences" viewer for the same file. MIT,
  BSD, Apache-2.0 and the SIL OFL all require their notices to accompany
  a distributed binary, and the three bundled typefaces are compiled into
  the app.
- A note in the bank setup guide stating that Koinkat is not affiliated
  with, endorsed by or sponsored by Enable Banking Oy, and dating the
  Control Panel walkthrough.
- Guidance on revoking a bank consent early, naming your bank's own
  consent dashboard and Enable Banking's consents page. Neither was
  documented before.

### Changed
- Corrected the privacy and network claims in the README, the privacy
  policy and the installer metadata. The content-security policy
  constrains the webview; it does not constrain the Rust dependency tree,
  and the previous wording implied otherwise. The outbound-connection
  list now also covers links opened in your browser.
- The callback page is now presented as two equal options, Koinkat's
  shared page or your own copy, with the trade-off stated: whose
  infrastructure the authorization code passes through. The page is
  served from GitHub Pages, which records the request URL; GitHub exposes
  no request logs to the owner of a Pages site.
- The crash screen no longer claims your data is safe, which it cannot
  know. It says what it does know: the database is a file on your device,
  nothing was sent anywhere, and unsaved input may be lost.
- `CONTRIBUTING.md` states that contributions are licensed inbound under
  GPL-3.0-or-later.

### Fixed
- Disconnecting a bank no longer reports success when revoking the
  Enable Banking session failed. The local link is still removed, because
  that is what you asked for, but you are now told the consent at your
  bank may still be live and where to revoke it. Previously every failure
  was discarded, so disconnecting while offline looked identical to
  disconnecting successfully.

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
