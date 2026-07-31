# Release signing setup (macOS)

The release workflow signs and notarizes macOS builds automatically when
six repository secrets exist. Without them, builds stay unsigned and the
workflow succeeds as before. Windows signing is handled through SignPath
(see [code-signing-policy.md](code-signing-policy.md)), not here.

## One-time setup

1. **Certificate.** In the Apple Developer account, create a
   **Developer ID Application** certificate (Certificates, Identifiers &
   Profiles > Certificates > + > Developer ID Application) and download
   it. Open it in Keychain Access on a Mac.
2. **Export as .p12.** In Keychain Access, select the certificate
   together with its private key, right-click > Export 2 items, choose
   the `.p12` format, and set a password. This password becomes
   `APPLE_CERTIFICATE_PASSWORD`.
3. **Base64-encode the .p12** into a single line for the secret:

```bash
base64 -i DeveloperID.p12 | tr -d '\n' | pbcopy
```

4. **App-specific password.** At [appleid.apple.com](https://appleid.apple.com),
   Sign-In and Security > App-Specific Passwords > generate one. This is
   `APPLE_PASSWORD` (used for notarization; the account password itself
   never goes into a secret).
5. **Team ID.** In the Apple Developer account, Membership details shows
   the 10-character Team ID.

## The six secrets

Create these under the repository's Settings > Secrets and variables >
Actions:

| Secret | Value |
|---|---|
| `APPLE_CERTIFICATE` | The base64 of the `.p12` (single line, step 3) |
| `APPLE_CERTIFICATE_PASSWORD` | The password chosen when exporting the `.p12` |
| `APPLE_SIGNING_IDENTITY` | The certificate's full name, e.g. `Developer ID Application: <name> (<team id>)` |
| `APPLE_ID` | The Apple account email |
| `APPLE_PASSWORD` | The app-specific password from step 4 |
| `APPLE_TEAM_ID` | The 10-character Team ID |

The workflow only exports these variables to the build when they are
non-empty, because the Tauri bundler treats an empty `APPLE_CERTIFICATE`
as present and would fail the build. Adding the secrets is the only
activation step; removing them returns releases to unsigned builds.

## Verifying a signed build

On a Mac, after installing a signed and notarized release:

```bash
spctl -a -t exec -vv /Applications/Koinkat.app
```

Expected output ends with `accepted` and
`source=Notarized Developer ID`.
