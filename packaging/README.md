# Packaging

## winget (`packaging/winget/`)

Manifests for the Windows Package Manager under the identifier
`MarcoSburlino.Koinkat`. They are submitted manually as a pull request to
[microsoft/winget-pkgs](https://github.com/microsoft/winget-pkgs) into
`manifests/m/MarcoSburlino/Koinkat/<version>/`.

Per-release update procedure:

1. Copy the three manifest files, replace every `0.1.0` with the new
   version, and update `ReleaseDate` to the release's publish date.
2. Update `InstallerUrl` to the new release's `_x64-setup.exe` asset.
3. Update `InstallerSha256` with the official digest GitHub records for
   that asset:

```bash
gh api repos/MarcoSburlino/Koinkat/releases/latest --jq '.assets[] | .name + " " + .digest'
```

   GitHub returns digests `sha256:`-prefixed and in lowercase; winget
   expects the prefix stripped and the hex uppercased.
4. Validate locally, then verify an install from the manifest folder:

```powershell
winget validate --manifest packaging\winget
```

```powershell
winget install --manifest packaging\winget
```

5. Submit the copied folder to `microsoft/winget-pkgs` (the maintainer
   does this; it is not automated).
