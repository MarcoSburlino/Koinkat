# Release signing setup

The release workflow signs and notarizes macOS builds automatically when
six repository secrets exist. Without them, builds stay unsigned and the
workflow succeeds as before. Windows builds are not signed (see
[code-signing-policy.md](code-signing-policy.md)); the last section here
covers antivirus false positives on Windows, which are a separate matter
from signing.

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

## Windows: reporting antivirus false positives

This is separate from the SmartScreen dialog. When Microsoft Defender or
a third-party antivirus flags an installer as malware outright, that is
a false positive, and the vendor clears it on request. This is the
standard channel unsigned open-source projects use:

- **Microsoft Defender:** submit the flagged `.exe` or `.msi` at the
  [Microsoft Security Intelligence portal](https://www.microsoft.com/en-us/wdsi/filesubmission).
  Choose "Software developer", attach the file, and mark it as an
  incorrect detection. Reviews typically land within days and ship as a
  Defender definitions update, which also feeds SmartScreen reputation.
- **Other engines:** upload each release's installers to
  [VirusTotal](https://www.virustotal.com/) to see which engines flag
  them. Every major vendor (Avast, AVG, Bitdefender, Kaspersky, Norton
  and the rest) runs its own false-positive form; submitting to the two
  or three engines VirusTotal shows flagging is usually enough.

This is per-release work: every new installer is a new file hash with no
reputation, so resubmit after each release. It addresses outright
antivirus blocks, not the SmartScreen "unrecognized app" dialog, which
needs a signature or accumulated download reputation.
