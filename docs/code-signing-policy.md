# Code signing policy

Koinkat release artifacts are signed so that users can verify they were
built from this repository and have not been tampered with in transit.

## Windows

Free code signing provided by [SignPath.io](https://about.signpath.io/),
certificate by [SignPath Foundation](https://signpath.org/).

Status: application pending. Until approval, Windows installers are
unsigned and Windows SmartScreen will warn on first run. The README's
Windows install section documents the exact steps to proceed past the
warning.

The private key is held by SignPath in a hardware security module. This
project never has access to it. Every signing request is submitted by
the release workflow in `.github/workflows/release.yml` and requires
manual approval before a signature is issued.

## macOS

Signed with an Apple Developer ID Application certificate and notarized
by Apple. The notarization ticket is stapled to the artifact at release
time.

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
maintainer's GitHub account and on SignPath.

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

To report a signed artifact that appears to violate SignPath Foundation
policy, contact [support@signpath.io](mailto:support@signpath.io). To
report a security issue in Koinkat itself, see
[SECURITY.md](../SECURITY.md).
