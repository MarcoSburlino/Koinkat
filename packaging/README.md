# Packaging: free distribution channels

Files here support the zero-cost distribution channels described in
[docs/signing.md](../docs/signing.md). They are kept in this repository
because their natural homes are *other* repositories (Microsoft's
winget-pkgs, a personal Homebrew tap); this is the staging area and the
place where release bumps are prepared.

## winget (`packaging/winget/`)

Three manifests describing the Windows NSIS installer for
`winget install MarcoSburlino.Koinkat`. Submission is a PR to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs):

1. Fork microsoft/winget-pkgs.
2. Copy the three files to
   `manifests/m/MarcoSburlino/Koinkat/0.1.0/` in the fork.
3. Validate locally if on Windows: `winget validate --manifest <dir>`
   (and optionally `winget install --manifest <dir>` in a VM).
4. Open the PR; Microsoft's automation validates the URL + SHA256 and
   scans the installer, then a human merges.

For each new release, the [`wingetcreate`](https://github.com/microsoft/winget-create)
tool automates the bump and the PR:

```powershell
wingetcreate update MarcoSburlino.Koinkat --version <new version> --urls <new installer url> --submit
```

The SHA256 in the installer manifest must match the release asset;
GitHub's API reports the official digest for every asset
(`gh api repos/MarcoSburlino/Koinkat/releases/latest --jq '.assets[] | .name + " " + .digest'`).

## Homebrew tap (`packaging/homebrew/`)

A cask for a personal tap — personal taps have no notability
requirements, unlike homebrew/cask:

1. Create a public repository named exactly `homebrew-koinkat` under
   the `MarcoSburlino` account.
2. Copy `packaging/homebrew/Casks/koinkat.rb` into it at
   `Casks/koinkat.rb`.
3. Users install with:

```bash
brew tap marcosburlino/koinkat
brew install --cask --no-quarantine koinkat
```

Per release, update `version` and `sha256` in the cask (both here and
in the tap repo — keep this copy as the source of truth).

## Flathub / AUR (not staged yet)

See [docs/signing.md](../docs/signing.md#5-linux-flathub-and-aur-free).
A flatpak manifest can be staged here the same way when tackled.
