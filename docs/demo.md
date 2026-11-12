# Koinkat Demo setup and recording

Koinkat Demo is the yellow, separate desktop build for tutorials with invented
finances. It uses Enable Banking's real HTTP API and accepts only an active
Sandbox application's credentials. The normal app keeps its existing identity.

Implementation roadmap and current status: [demo-sandbox.md](plans/demo-sandbox.md).

## Current installation handoff

The Fedora release RPM is built and inspected. It has no file-path overlap
with the installed `koinkat` package. Rust compilation, six native IPC tests,
and actual release-app onboarding, workspace/account creation and persistence
checks passed using temporary fictional profiles. The callback is deployed.
System installation is the next step requiring Marco's local sudo password:

```bash
sudo dnf install '/home/sbu/Projects/Koinkat/src-tauri/target/release/bundle/rpm/Koinkat Demo-0.1.7-1.x86_64.rpm'
```

Then open **Koinkat Demo** from GNOME. The installed app should start with
fresh onboarding; native test profiles were under `/tmp/`, not the default
app directories. The real Enable Banking sandbox flow remains untested until
Marco creates the application and completes browser consent below.

## Build on Fedora

Install the native build prerequisites in your own terminal. `sudo` requests
your administrator password locally; do not send it to an agent.

```bash
sudo dnf install rust cargo gcc gcc-c++ make pkgconf-pkg-config \
  webkit2gtk4.1-devel gtk3-devel openssl-devel librsvg2-devel \
  libxdo-devel dbus-devel
```

From the repository, once prerequisites are installed:

```bash
npm run typecheck
npm run test
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:build:demo -- --bundles rpm
```

Inspect the resulting RPM before installing it: its binary must be
`koinkat-demo`, with separate desktop/icon/resource paths. Native compile,
package inspection and desktop checks must pass before declaring it ready.

For development use **`npm run tauri:dev:demo`**. The ordinary `tauri:dev`
command uses the personal app's identifier and must not be used for this demo.
Demo frontend output goes to `dist-demo/`; production output goes to `dist/`.

## App separation

| Item | Demo value |
| --- | --- |
| App identifier | `com.koinkat.app.demo` |
| Binary | `koinkat-demo` |
| Credential-store service | `koinkat-demo` |
| URL scheme | `koinkat-demo://auth-callback` |
| Default Linux database | `~/.config/com.koinkat.app.demo/koinkat.db` |
| Redirect URL | `https://marcosburlino.github.io/koinkat-callback/?app=demo` |

Tauri resolves actual data directories, including XDG overrides. Demo never
needs a personal database copy or production private key. Existing old Demo
profiles are preserved; select a sandbox PEM again if its old key lived in
the normal app's namespace.

The callback's Demo-selector change is deployed at commit `f5ad698` in its
repository and GitHub Pages reports the build complete. The public page was
checked for the new routing code. The provider must preserve `app=demo` when
adding `code` and `state`; that remains a live pilot check.

## First provider pilot

This section is for the point when the native build and hosted callback are
verified. No provider login or credentials have been configured by the agent.

1. In a clean browser profile, sign into Enable Banking privately.
2. Create a **Sandbox** API application named `Koinkat Demo`. Keep browser key
   generation selected and register the exact Demo redirect URL from the table.
3. Save the downloaded PEM privately and back it up. Note its application ID.
4. Open Mock ASPSPs in the Control Panel and configure the pilot from
   [pilot.json](../examples/sandbox/pilot.json). It follows the provider's
   [published synthetic sample](https://enablebanking.com/sample-data/DK-Danske_Bank-synthetic-1.json).
   Its acceptance by the authenticated editor remains unverified; if that
   editor uses a different wrapper, adapt the file before continuing.
5. Open Koinkat Demo, create a fictional local user, choose **Sandbox** and
   name the workspace `Pilot`. Select DKK as its preferred currency.
6. Enter the application ID and select the matching PEM with the file picker.
   Keep the pre-filled redirect URL and click **Create & verify**.
7. Select Denmark and **Mock ASPSP**, import the last 30 days, and complete
   simulated browser consent. Allow **Open Koinkat Demo**.
8. Expect one fictional DKK account, four booked transactions and DKK 9,060.00.
   Run another sync and reconnect: neither should duplicate the existing rows
   or account. Exercise manual Copy Code in a separate fresh connection attempt.

Pilot dates are 2026-11-07 through 2026-11-10. Refresh them and the balance
reference dates if filming after they leave the import window. Opening balance
is zero: 10,000.00 income minus 800.00, 40.00 and 100.00 expenses = 9,060.00.
The account number and every counterparty are fictional test data.

Do not paste a PEM, email login link or authentication code into project notes
or chat. Choosing the PEM in the app is sufficient. Full dataset generation
waits for a successful small import and confirmation of the provider's format.

## Recording checklist

- Keep separate `Recording` and populated `Showcase` workspaces. A new workspace
  repeats workspace onboarding; the first-user screen requires a separately
  preserved/reset Demo profile, including its WebView state. Avoid a whole-app
  reset until that procedure has been implemented and verified.
- Explain that credentials are an application ID plus a private key file.
  Show selecting the file, not its contents.
- Label the Demo package and redirect as recording-specific. Viewers should
  download the normal Koinkat release and use its normal callback URL.
- Explain the production-only registration fields and account-whitelisting
  step; sandbox auto-activation does not demonstrate them.
- Check notification previews, browser tabs, downloads and autofill before
  recording. Keep any saved app snapshots private.
- Freeze one recording date/dataset for all takes. Refresh it for later videos.

The launcher icon was created with the built-in imagegen tool from the existing
app icon, with the prompt to preserve the K/cat silhouette, use warm yellow
`#F4C542`, retain transparency, and remove texture/speckles. Its source is
`src-tauri/icons-demo/source.png`; desktop sizes were produced by `tauri icon`.
The header tints the existing wordmark with a CSS mask to preserve its shape.
