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

## Privacy

The privacy policy lives in one place:
[docs/privacy-policy.md](privacy-policy.md). It is not restated here,
because this file and that one drifted apart once already and a second
copy will drift again.

Two points are repeated only because signing and distribution
paperwork tends to ask for them directly:

- **Publisher identity.** Release artifacts are published by Marco
  Sburlino, an individual, from
  <https://github.com/MarcoSburlino/Koinkat>. There is no company behind
  the project and no legal entity to name on a certificate.
- **What the signed binary does on a network.** It contacts Enable
  Banking only if the user has supplied their own credentials and asked
  to link a bank, and a public exchange-rate CDN for currency
  conversion. It can also ask the operating system to open links in the
  user's browser. There is no update mechanism, no telemetry endpoint
  and no crash reporting, so a signed build phones nothing home on its
  own. The full inventory, including what the content-security policy
  does and does not constrain, is in the README under
  [How Koinkat handles your data](../README.md#how-koinkat-handles-your-data).

## Uninstallation

Koinkat can be uninstalled through the standard mechanism for each
platform. The README's "Uninstalling" section documents both application
removal and complete data removal, including the location of the local
database and the keychain entries to delete on each operating system.

## Reporting

To report a security issue in Koinkat, see
[SECURITY.md](../SECURITY.md).
