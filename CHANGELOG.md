# Changelog

All notable changes to Koinkat are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project
uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.4] - 2026-09-19

The outcome of a full correctness audit. Eight classes of defect, each one
able to give you a wrong number and none of them obvious from the screen.
If you have been running Koinkat with more than one currency, with bank
imports, or with split expenses, some of your stored figures may have been
wrong; this release stops that happening again. Test coverage grew from 174
to 249, on a harness that runs the real migrations against a real database.

### Fixed
- Two things happening at once could lose one of them. Every write now runs
  inside a transaction that owns a single database connection from start to
  finish. Two expenses of 10 recorded against a balance of 100 leave 80;
  previously one could overwrite the other and leave 90.
- Converted amounts could come out as zero. The exchange rate was rounded to
  four decimal places before being applied, which flattens any rate below
  0.0001 to nothing: 1,000,000 VND converted to 0.00 USD instead of 40.00.
  Rates are now applied at full precision and stored to twelve decimal
  places. Four decimal places remain what you see, not what is used.
- Switching workspace while a conversion was in flight could write the
  result into the workspace you switched to. Those writes now cancel
  instead.
- Deleting a pending bank transaction changed your balance, even though
  adding it never had. Pending rows are balance-neutral in both directions
  now, so deleting a pending expense of 10 from 100 leaves 100.
- A pending transaction that settled could be counted twice, or deleted
  outright by the cleanup that follows a sync. A settling row is now matched
  and promoted in place. Two genuinely identical payments still stay two
  separate rows.
- Re-authorizing a bank created a second copy of each account and
  double-counted its balance. Accounts are now recognized across sessions by
  the bank's own stable identifier, falling back to IBAN and currency.
- A split expense reimbursed for more than it cost was reported as spending
  rather than as money back. Costing 100 and being reimbursed 120 now reads
  as -20.
- Entering a same-currency transaction no longer fails when exchange rates
  are unavailable.
- Exported database backups are taken as a single consistent snapshot, so a
  backup can no longer miss recent changes or include abandoned ones.

### Changed
- The full licence text ships with the app and is readable under
  Settings > About.
- Line endings for migration files are pinned. The app identifies each
  migration by an exact byte-for-byte hash, so a build made on a machine
  configured differently could refuse to open an existing database.

## [0.1.3] - 2026-09-12

One bug, but an alarming one. After restarting Windows, Koinkat could open
on the first-run "Create your Koinkat user" screen while the database sat
on disk completely intact. Nothing was ever deleted, and no release has
ever deleted anything here, but the app said otherwise and invited you to
start over. This release makes that failure impossible to mistake for a
fresh install, and moves the record of which user and workspace are active
somewhere that survives.

### Fixed
- A database that cannot be read at startup no longer renders the
  registration form. Startup used to pick its fallback screen from the list
  of users, which is still empty when loading that very list is what
  failed, so it concluded you were new. A restart leaves SQLite's
  write-ahead log to recover, and Koinkat opened a second connection pool
  on the same file while that was happening, which is what made the read
  fail intermittently. The second pool is gone.
- Retrying after a failed start now works. The database handle cached the
  failed attempt and replayed it for the rest of the session, so nothing
  could recover without quitting the app.
- Exporting the database now flushes the write-ahead log first. The export
  copied only the main file, so recent transactions could be missing from
  the backup without any sign that anything was wrong.
- Losing the active user or workspace no longer happens because of a read
  that errored. Those pointers are now discarded only when a successful
  read confirms the row is genuinely gone.

### Added
- A dedicated screen for a startup failure, stating plainly that nothing
  has been deleted, naming the database file, and offering a retry. It has
  no way to create a user, deliberately.

### Changed
- The active user and active workspace are stored in the database itself
  (migration v12) rather than only in the webview's local storage, which
  Windows can clear and which is not shared between builds. Your existing
  selection is carried over on first launch.
- If the pointer is missing at startup and there is only one user or only
  one workspace, Koinkat now opens it instead of asking you to pick from a
  list of one.

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
