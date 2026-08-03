# Code signing policy

Koinkat release artifacts are signed so that users can verify they were
built from this repository and have not been tampered with in transit.

## Windows

Windows builds are not code-signed. Two consequences follow: SmartScreen
warns on first run for installers downloaded through a browser, and some
antivirus engines flag unsigned NSIS installers on heuristics alone.

Two install routes avoid the browser download that triggers those
warnings: installing through winget
(`winget install MarcoSburlino.Koinkat`, once the package is accepted
into the winget repository), and downloading the installer with
`curl.exe` from PowerShell, which does not mark the file as
internet-downloaded. The README's Windows install section has the exact
commands for both, and the steps to proceed past the warning for a
browser download.

Every GitHub release publishes a SHA256 digest for each artifact, so a
download can be verified independently of any signature.

Signing the Windows artifacts is intended. It is not in place yet.

## macOS

Release builds are signed with an Apple Developer ID Application
certificate and notarized by Apple, and the notarization ticket is
stapled to the artifact at release time. The app opens with no security
dialog.

Signing began with v0.1.1, the first signed release. Builds up to and
including v0.1.0 are unsigned, so macOS still refuses them with its
quarantine dialog ("Koinkat is damaged and can't be opened"). Updating
to v0.1.1 or later is the fix; nothing needs to be worked around.

## Linux

`.deb` and `.rpm` packages are distributed unsigned. Verify the SHA256
digests published with each GitHub release.

## Team roles

Koinkat is maintained by a single person. All three roles are held by
the repository owner:

- Authors (may modify source without additional review):
  [MarcoSburlino](https://github.com/MarcoSburlino)
- Reviewers (must review every change proposed by a non-committer):
  [MarcoSburlino](https://github.com/MarcoSburlino)
- Approvers (decide whether a given release may be signed):
  [MarcoSburlino](https://github.com/MarcoSburlino)

All contributions from outside this list arrive as pull requests and are
reviewed before merge. Multi-factor authentication is enforced on the
maintainer's GitHub account.

## Privacy policy

Koinkat is a local-first application. All financial data, meaning
accounts, transactions, balances, budgets and categorization rules, is
stored in a SQLite database on the user's own machine. Credentials are
held in the operating system keychain. There is no Koinkat server, no
account system, and no telemetry, analytics or crash reporting of any
kind. Error reports are composed locally and never transmitted. No usage
data is ever collected or sent anywhere.

The application makes network requests to exactly two categories of
endpoint:

1. Enable Banking (`api.enablebanking.com`), contacted only after the
   user supplies their own Enable Banking application credentials and
   explicitly initiates a bank connection. Bank data flows directly
   between the user's machine and Enable Banking. It does not pass
   through any infrastructure operated by this project. Users who
   connect a bank are subject to
   [Enable Banking's privacy policy](https://enablebanking.com/privacy/).
   Users who do not connect a bank, and instead enter transactions
   manually, never contact this endpoint at all.
2. Public foreign-exchange rate data (`cdn.jsdelivr.net`, with
   `*.currency-api.pages.dev` as a fallback), fetched automatically
   to convert between currencies. These are read-only requests for
   public rate tables. They carry no user data, no identifiers and no
   account information. The request reveals nothing beyond the fact that
   some client asked for a rate file.

These restrictions are enforced at build time by the application's
Content Security Policy: outbound data connections are limited to the
hosts listed above, and any other destination is blocked by the runtime
rather than by convention. Fonts are bundled with the application, so no
external font or asset host is contacted.

## Uninstallation

Koinkat can be uninstalled through the standard mechanism for each
platform. The README's "Uninstalling" section documents both application
removal and complete data removal, including the location of the local
database and the keychain entries to delete on each operating system.

## Reporting

To report a security issue in Koinkat, see
[SECURITY.md](../SECURITY.md).
