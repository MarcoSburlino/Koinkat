# Fixing blocked installs without paying for certificates

Downloaded Koinkat installers get blocked because release builds are
not code-signed. This document explains the mechanics and lays out the
**zero-cost playbook** for reducing or eliminating the blocks. Paid
signing (which the project deliberately does not buy) is covered at the
end only as reference — the release pipeline is already wired for it if
that ever changes.

## Why installs get blocked

| OS | What the user sees | Mechanism |
|---|---|---|
| Windows | "Windows protected your PC" (SmartScreen); Defender/AV flags | SmartScreen blocks internet-downloaded executables that have no signature *and* no accumulated reputation. Unsigned NSIS installers also score high in AV heuristics because that packaging is popular with malware. |
| macOS | "Koinkat is damaged and can't be opened" or "unidentified developer" | Gatekeeper refuses **quarantined** apps that are not Developer-ID-signed and notarized. The "damaged" wording is misleading but standard: it is the quarantine block, not corruption. |
| Linux | AppImage won't start | Not signing-related: missing exec bit, or missing FUSE 2 on recent Ubuntu/Debian. |

Key insight for the free playbook: on macOS the trigger is the
`com.apple.quarantine` flag that **browsers** attach to downloads, and
on Windows the trigger is the Mark-of-the-Web plus zero reputation.
Distribution channels that sidestep those triggers avoid the dialogs
without any certificate.

## The free playbook

### 1. Windows: apply to SignPath Foundation (free, real signing)

[SignPath](https://signpath.io/open-source) runs a program that gives
qualifying open-source projects **free code signing**: the SignPath
Foundation signs your CI-built artifacts with its own publicly trusted
certificate. Koinkat is a good fit (OSS license, public CI builds on
GitHub Actions). This is the only genuinely free way to get Windows
binaries signed.

- Apply on their site with the repository link.
- Once approved, integration is their GitHub Action
  ([`SignPath/github-action-submit-signing-request`](https://github.com/SignPath/github-action-submit-signing-request)):
  the release workflow uploads the built `.exe`/`.msi` as a signing
  request and downloads the signed artifact before attaching it to the
  release. Wire it into `release.yml` when the account exists.
- Note their conditions: the certificate names SignPath Foundation OSS
  as publisher (with the project in the metadata), and they require the
  build to be reproducible from public CI.

### 2. Windows: publish to winget (free, no certificate)

`winget install MarcoSburlino.Koinkat` downloads and runs the installer
without the browser download flow, so users never meet the SmartScreen
dialog. Microsoft validates submissions on their side.

Ready-to-submit manifests for v0.1.0 (with the official release SHA256
hashes) are in [`packaging/winget/`](../packaging/winget/) — see
[`packaging/README.md`](../packaging/README.md) for the submission
steps. Per release, only version + hashes change; the
`wingetcreate update` command automates the bump.

### 3. macOS: offer the Terminal install path (free, no dialogs)

There is **no free signing or notarization for macOS** — ad-hoc
signing, self-signed certificates, and free Apple accounts all still
hit Gatekeeper. But Gatekeeper only assesses *quarantined* apps, and
the quarantine flag is attached by browsers. `curl` and `tar` do not
set it, so this installs with no warning dialogs at all:

```bash
cd ~/Downloads
curl -L -o Koinkat.app.tar.gz https://github.com/MarcoSburlino/Koinkat/releases/latest/download/Koinkat_0.1.0_aarch64.app.tar.gz
tar xzf Koinkat.app.tar.gz
mv Koinkat.app /Applications/
```

This is now documented in the README as the recommended macOS
alternative, and the release notes point to it. The `.app.tar.gz`
asset that Tauri already uploads with every release is exactly what
this needs — no pipeline change required.

### 4. macOS: personal Homebrew tap (free)

A tap repo needs no notability threshold (unlike homebrew/cask). Create
a repository named `homebrew-koinkat` under your account, copy
[`packaging/homebrew/Casks/koinkat.rb`](../packaging/homebrew/Casks/koinkat.rb)
into it, and users install with:

```bash
brew tap marcosburlino/koinkat
brew install --cask --no-quarantine koinkat
```

(`--no-quarantine` skips the Gatekeeper flag, mirroring the Terminal
path above; without it Homebrew applies quarantine and the usual
`xattr` workaround applies. The cask's caveats text explains this to
users.)

### 5. Linux: Flathub and AUR (free)

Linux friction is FUSE/exec-bit, not signatures. Flathub distribution
removes it entirely and is where many Linux users look first; an AUR
package covers Arch. Both are free; Flathub requires a flatpak manifest
(Tauri documents the process) and a review PR to flathub/flathub.

### 6. Keep the workaround docs prominent (done)

The README's step-by-step instructions for SmartScreen / Gatekeeper /
FUSE remain necessary for plain browser downloads, and the website and
release notes link to them.

### What the free playbook does not fix

A user who downloads the `.exe` in a browser and double-clicks it will
still see SmartScreen until the project either gets SignPath approval
or enough downloads accumulate reputation. Same for the `.dmg` in a
browser without the Terminal path. The free channels above are
alternatives around the dialogs, not a removal of them.

## Reference: the paid options (not planned)

The release workflow auto-enables signing if these secrets ever exist —
no workflow edits needed (steps are no-ops today):

- **macOS** (US$99/year, Apple Developer Program): Developer ID
  Application certificate + notarization. Secrets: `APPLE_CERTIFICATE`
  (base64 .p12), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`,
  `APPLE_ID`, `APPLE_PASSWORD` (app-specific), `APPLE_TEAM_ID`. Tauri
  imports, signs, notarizes, and staples natively. This is the only
  thing that removes the Gatekeeper dialogs for browser downloads.
- **Windows** (~US$10/month, Azure Artifact Signing — formerly Trusted
  Signing): secrets `AZURE_TENANT_ID`, `AZURE_CLIENT_ID`,
  `AZURE_CLIENT_SECRET`, `AZURE_SIGNING_ENDPOINT`,
  `AZURE_SIGNING_ACCOUNT`, `AZURE_SIGNING_PROFILE`. The workflow
  installs `artifact-signing-cli` and injects a
  `tauri.windows.conf.json` overlay with the `signCommand`. Classic OV
  certificates (Certum ~€70/yr for OSS) also work via `signCommand`,
  but fresh OV certs still warn until reputation accrues.
