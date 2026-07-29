# Code signing and the "blocked install" problem

This document explains why downloaded Koinkat installers get blocked or
flagged on Windows and macOS, what actually fixes it, what each fix
costs, and exactly how to turn signing on in this repository's release
pipeline. It is written for the maintainer; end-user workarounds live in
the [README install guide](../README.md#path-a-install-the-released-app).

## Why installs get blocked

The releases built by `.github/workflows/release.yml` are **not
code-signed**. That single fact produces every symptom users report:

| OS | What the user sees | Mechanism |
|---|---|---|
| Windows | "Windows protected your PC" (SmartScreen), Defender or third-party AV quarantining the installer | SmartScreen blocks executables that carry the "downloaded from the internet" mark and have no signature *and* no accumulated reputation. Unsigned NSIS installers are also a favorite packaging for malware, so AV heuristics score them aggressively. |
| macOS | "Koinkat is damaged and can't be opened" or "unidentified developer" | Gatekeeper refuses quarantined apps that are not signed with a Developer ID certificate **and notarized by Apple**. The "damaged" wording is misleading but standard: it is the quarantine block, not corruption. |
| Linux | AppImage won't start | Not a signing issue: the AppImage needs `chmod +x`, and recent Ubuntu/Debian lack the FUSE 2 library it needs (`sudo apt install libfuse2`). deb/rpm install normally. |

Nothing about the app's behavior triggers this: a hello-world app
shipped the same way gets the same treatment. The fix is identity, not
code changes.

## What fixes it

### macOS — Apple Developer Program + notarization

**Cost: US$99/year.** There is no free path: ad-hoc signing, self-signed
certificates, and free Apple accounts all still hit the Gatekeeper
block. Once builds are Developer-ID-signed and notarized, the app opens
with no dialog at all.

1. Join the [Apple Developer Program](https://developer.apple.com/programs/)
   (the account holder role is required for the next step).
2. In Xcode or at developer.apple.com, create a **Developer ID
   Application** certificate. Download it, add it to your local
   Keychain, then export it (certificate + private key) as a `.p12` file
   with a password.
3. Base64-encode the file: `base64 -i certificate.p12 | pbcopy`
4. Create an **app-specific password** for your Apple ID at
   [account.apple.com](https://account.apple.com/) (Sign-In and
   Security > App-Specific Passwords). Notarization uses it; your real
   password never goes into CI.
5. Add these repository secrets (Settings > Secrets and variables >
   Actions):

   | Secret | Value |
   |---|---|
   | `APPLE_CERTIFICATE` | base64 of the `.p12` |
   | `APPLE_CERTIFICATE_PASSWORD` | the `.p12` export password |
   | `APPLE_SIGNING_IDENTITY` | the certificate name, e.g. `Developer ID Application: Marco Sburlino (TEAMID)` |
   | `APPLE_ID` | your Apple ID email |
   | `APPLE_PASSWORD` | the app-specific password |
   | `APPLE_TEAM_ID` | your 10-character team ID |

That's it — the release workflow detects `APPLE_CERTIFICATE` and
enables signing + notarization automatically (Tauri imports the
certificate into a temporary keychain, signs the bundle, submits it to
Apple's notary service, and staples the ticket). Verify a produced
build with:

```bash
spctl -a -t exec -vv /Applications/Koinkat.app   # should say "accepted ... Notarized Developer ID"
```

While at it, consider adding an Intel (x86_64) or universal build —
today's release is Apple Silicon only, which is a separate reason some
Mac users cannot run the app at all.

### Windows — Azure Artifact Signing (recommended) or an OV certificate

**Option A — Azure Artifact Signing** (formerly "Trusted Signing"),
**~US$10/month**. Microsoft's cloud signing service; certificates are
short-lived and managed for you, and signatures get SmartScreen
reputation quickly. Individual (non-company) identity validation is
supported.

1. Create an [Azure account](https://azure.microsoft.com/) and an
   **Artifact Signing** (Trusted Signing) resource; complete identity
   validation and create a **certificate profile** (public trust).
2. Create a Microsoft Entra **App Registration** with a client secret,
   and give it the *Trusted Signing Certificate Profile Signer* role on
   the signing account.
3. Add these repository secrets:

   | Secret | Value |
   |---|---|
   | `AZURE_TENANT_ID` | Entra directory (tenant) ID |
   | `AZURE_CLIENT_ID` | App Registration client ID |
   | `AZURE_CLIENT_SECRET` | App Registration client secret |
   | `AZURE_SIGNING_ENDPOINT` | e.g. `https://weu.codesigning.azure.net` (your region) |
   | `AZURE_SIGNING_ACCOUNT` | the signing account name |
   | `AZURE_SIGNING_PROFILE` | the certificate profile name |

The release workflow detects `AZURE_CLIENT_SECRET`, installs
[`artifact-signing-cli`](https://crates.io/crates/artifact-signing-cli),
and writes a `tauri.windows.conf.json` overlay whose
`bundle.windows.signCommand` signs every produced `.exe` and `.msi`.

**Option B — a classic OV code-signing certificate** (Certum's open
source certificate is the cheapest route, roughly €70 first year;
Sectigo/SSL.com OV certs run US$70–250/year). Works, but note: a fresh
OV certificate does **not** silence SmartScreen immediately — reputation
accrues per certificate as downloads accumulate, so early downloads
still warn. Most CAs now require the key on hardware (token or cloud
HSM), which complicates CI; if you go this route, wire the vendor's
signing tool into `bundle > windows > signCommand` the same way the
workflow does for Option A.

### Zero-cost mitigations (no certificate)

These don't remove the warnings from direct downloads, but reduce how
many users hit them:

- **winget** — submit a manifest to
  [microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs)
  pointing at the release installer. `winget install koinkat` installs
  without the SmartScreen browser-download flow, and is re-validated by
  Microsoft's pipeline on submission.
- **Homebrew cask** for macOS — `brew install --cask` users can bypass
  quarantine knowingly; note homebrew/cask has notability requirements
  (GitHub stars/forks) that a young project may not meet yet, but a
  personal tap (`brew tap marcosburlino/koinkat`) works today with no
  requirements.
- **Flathub / AUR** for Linux — solves the AppImage FUSE friction
  entirely and is where many Linux users look first.
- Keep the README's step-by-step "how to get past the warning"
  instructions (already done) and link them from every download
  surface, including the website.

## How the pipeline behaves

`release.yml` is now signing-ready but signing-optional:

- **No secrets configured** (today): the enable-signing steps print
  "build will be UNSIGNED" and exit; the release is built exactly as
  before.
- **Apple secrets added**: the macOS job signs and notarizes; the
  Gatekeeper "damaged"/"unidentified developer" dialogs disappear for
  new releases.
- **Azure secrets added**: the Windows job signs the NSIS and MSI
  installers; SmartScreen and most AV heuristic flags disappear for new
  releases.

No workflow edits are needed when the secrets are added later — push
the next version tag and the release comes out signed.
