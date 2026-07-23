# Koinkat

[![CI](https://github.com/MarcoSburlino/Koinkat/actions/workflows/ci.yml/badge.svg)](https://github.com/MarcoSburlino/Koinkat/actions/workflows/ci.yml)

Local-first multi-currency personal finance manager. Built as a Tauri 2
desktop app. All data stays on your device - no cloud, no telemetry, no
accounts system.

> **Status:** v0.1.0 is the first public release. If something does not
> behave as this guide describes, please
> [open an issue](https://github.com/MarcoSburlino/Koinkat/issues).

<!-- SCREENSHOT: docs/images/06-dashboard.png - Dashboard with accounts and the month pulse card -->

## Contents

- [What it does](#what-it-does)
- [How Koinkat handles your data](#how-koinkat-handles-your-data)
- [Install](#install)
  - [Path A: install the released app](#path-a-install-the-released-app)
  - [Path B: build from source](#path-b-build-from-source)
- [First run: setting up inside the app](#first-run-setting-up-inside-the-app)
- [Connecting a bank](#connecting-a-bank)
- [Troubleshooting](#troubleshooting)
- [Build modes](#build-modes)
- [Stack](#stack)
- [Security model](#security-model)
- [Repository layout](#repository-layout)
- [Documentation](#documentation)
- [Contributing](#contributing)
- [License](#license)

## What it does

- Track multiple bank accounts across currencies. Net worth converted to
  your preferred currency at today's rates; balances stay reproducible
  because every transaction stores the FX rate it was recorded at.
- Connect European banks via PSD2 through [Enable Banking](https://enablebanking.com/),
  or use manual accounts only.
- Categorize transactions with a learning rule engine (user rules + MCC
  fallback + a Review inbox for anything unmatched).
- Track split expenses, including repayments via PayPal / cash / channels
  outside your bank accounts.
- Recurring budgets + one-off "envelope" events with multi-currency math.
- Multi-workspace: each workspace is fully isolated (its own accounts,
  categories, budgets, bank links).

## How Koinkat handles your data

Koinkat is local-first. Your financial data lives in a database file on
your own computer. There is no Koinkat server, no account with us, no
sign-up, no telemetry, and no analytics. Nobody involved in this project
can see your data.

That said, "local-first" does not mean the app never touches the
internet. Here is the complete list of outbound connections the app
makes, verified from the source code:

| Connection | When | What is sent | What is not sent |
|---|---|---|---|
| `api.enablebanking.com` | Only if you link a bank, during linking and syncs | Requests signed with your own Enable Banking application ID, the bank you picked, and session identifiers; the API returns your balances and transactions | Your online-banking username and password - you enter those on your bank's own website, never in Koinkat |
| `cdn.jsdelivr.net` (fallback: `*.currency-api.pages.dev`) | On app start and before syncs | A request for the day's public exchange-rate table (`.../currency-api@<date>/v1/currencies/usd.json`) | Anything about you - the URL contains only the date; not even your chosen currency |
| `fonts.googleapis.com` and `fonts.gstatic.com` | At app launch | A standard request for the app's fonts (DM Sans, DM Serif Display, JetBrains Mono) | Any app or financial data |
| Your bank's authorization page, then `marcosburlino.github.io/koinkat-callback/` | Only during bank linking, in your regular browser (not inside the app) | The bank redirects your browser to the callback page with a one-time authorization code; the page is a single static file that makes zero further network requests and hands the code back to the app locally | The code is never sent anywhere by the page, and it is useless without the private key that exists only on your machine |

Like every internet request, these servers technically see your IP
address. Beyond the list above there is nothing: no update pings, no
crash reporting, no tracking. The app's content-security policy blocks
requests to any other host, so a bug or a compromised dependency could
not quietly phone home.

Where things physically live:

| What | Where |
|---|---|
| Your database (`koinkat.db`) - Windows | `C:\Users\<you>\AppData\Roaming\com.koinkat.app\koinkat.db` |
| Your database - macOS | `~/Library/Application Support/com.koinkat.app/koinkat.db` |
| Your database - Linux | `~/.config/com.koinkat.app/koinkat.db` |
| Your Enable Banking private key | The OS credential store: Windows Credential Manager, macOS Keychain, or the Linux secret service (GNOME Keyring / KWallet). Not in the database. If no credential store is available, Koinkat falls back to the database and says so in Settings. |

The database is not encrypted at rest - anyone with access to your OS
user account can read it. Use OS disk encryption (BitLocker, FileVault,
LUKS) if that matters to you. See [Security model](#security-model) for
the rest of the picture.

## Install

There are two ways to get Koinkat. Most people want Path A: download a
ready-made installer. Path B builds the app from this source code, which
takes longer but means you run exactly what you can read.

### Path A: install the released app

Every release of Koinkat comes with ready-made installer files attached
to it. The steps below are complete for each operating system, from
finding the right file to launching the installed app, so jump straight
to the section for your system.

#### Why the installers show a security warning

Windows and macOS only skip their warnings for apps whose maker bought a
code-signing identity: an Apple developer membership or a Windows
code-signing certificate, both of which cost a meaningful yearly fee.
Koinkat is free, open-source software with no revenue, so that money is
deliberately not spent. Signing changes the label the operating system
puts on an app, not what the app does: the full source code is public,
and Path B below builds the identical app from it. The warnings you will
see in the steps below are therefore expected, and the steps show
exactly how to proceed past them.

#### Windows

1. In your browser, open the latest release page:
   [github.com/MarcoSburlino/Koinkat/releases/latest](https://github.com/MarcoSburlino/Koinkat/releases/latest).
2. Scroll past the release description to the **Assets** section. If
   you only see the word "Assets" with a number next to it, click it -
   the list of downloadable files unfolds.
3. Click the file named `Koinkat_0.1.0_x64-setup.exe`. In newer
   releases the version number in the middle changes; the file you want
   is the one ending in `_x64-setup.exe`. Ignore the two "Source code"
   entries at the bottom of the list - they contain the program's
   source, not an installer. (If your organization prefers MSI
   packages, the file ending in `_x64_en-US.msi` installs the same
   app.)
4. The browser saves the file to your **Downloads** folder. Open it:
   open **File Explorer** (the folder icon in the taskbar) and click
   **Downloads** in the left sidebar - or press Ctrl+J in the browser
   and open the file from its download list.
5. Double-click `Koinkat_0.1.0_x64-setup.exe`.
6. A blue dialog titled **"Windows protected your PC"** appears, saying
   Microsoft Defender SmartScreen prevented an unrecognized app from
   starting. This is the unsigned-app warning explained above.
7. Click the small **More info** link in that dialog. A **Run anyway**
   button appears; click it.
8. The installer opens. Accept the defaults and click through to
   **Finish**.
9. To start the app: press the **Start** key, type `Koinkat`, and press
   Enter. Koinkat is now in your Start menu like any other program.

#### macOS

1. In your browser, open the latest release page:
   [github.com/MarcoSburlino/Koinkat/releases/latest](https://github.com/MarcoSburlino/Koinkat/releases/latest).
2. Scroll past the release description to the **Assets** section. If
   you only see the word "Assets" with a number next to it, click it -
   the list of downloadable files unfolds.
3. Click the file ending in `.dmg` (for version 0.1.0:
   `Koinkat_0.1.0_aarch64.dmg`). Ignore the "Source code" entries -
   they are not installers.
   **Important:** this build runs on Apple Silicon Macs only (M1 chip or
   newer, roughly every Mac sold since late 2020). There is currently no
   build for older Intel Macs; on those, use
   [Path B](#path-b-build-from-source).
4. Open your Downloads folder (the **Downloads** stack at the right end
   of the Dock, or **Finder** and then **Downloads** in the sidebar) and
   double-click the `.dmg` file.
5. A window opens showing the Koinkat icon and an Applications folder
   shortcut. Drag the Koinkat icon onto **Applications**.
6. Open **Launchpad** (or Finder > Applications) and click Koinkat. On
   first open, macOS blocks the app because it is not signed.
7. Open **System Settings**, go to **Privacy & Security**, and scroll
   down: you will find a message saying Koinkat was blocked. Click
   **Open Anyway** and confirm. (On macOS versions before Sequoia you
   can instead right-click the app in Applications and choose **Open**.)
8. If macOS instead claims the app "is damaged and can't be opened",
   the download is not actually damaged: that message is how macOS
   flags unsigned apps it quarantined during download. To clear the
   flag, open **Terminal** (press Cmd+Space, type `terminal`, press
   Enter) and run:

```bash
xattr -cr /Applications/Koinkat.app
```

   Then open the app again from Applications.

#### Linux

1. In your browser, open the latest release page:
   [github.com/MarcoSburlino/Koinkat/releases/latest](https://github.com/MarcoSburlino/Koinkat/releases/latest).
2. Scroll past the release description to the **Assets** section; click
   the word "Assets" if the file list is folded away.
3. Download the format that fits your distribution - the bullets below
   explain each of the three. Ignore the "Source code" entries; they
   are not installers.

The commands below assume the file landed in your Downloads folder.
Open a terminal (usually Ctrl+Alt+T) and move there first:

```bash
cd ~/Downloads
```

- **AppImage** (`Koinkat_<version>_amd64.AppImage`) - a single file that
  runs on almost any distribution without installing. Mark it executable
  once, then run it:

```bash
chmod +x Koinkat_0.1.0_amd64.AppImage
./Koinkat_0.1.0_amd64.AppImage
```

- **Debian / Ubuntu** (`Koinkat_<version>_amd64.deb`):

```bash
sudo apt install ./Koinkat_0.1.0_amd64.deb
```

- **Fedora / openSUSE** (`Koinkat-<version>-1.x86_64.rpm`):

```bash
sudo rpm -i Koinkat-0.1.0-1.x86_64.rpm
```

After the deb or rpm install, Koinkat appears in your application menu.

### Path B: build from source

This path assumes nothing: if you have never used a terminal, start
here.

**Opening a terminal:**

- **Windows:** press the Start key, type `powershell`, press Enter.
- **macOS:** press Cmd+Space, type `terminal`, press Enter.
- **Linux:** usually Ctrl+Alt+T, or find "Terminal" in your app menu.

You type commands at the prompt and press Enter to run them. Copy the
commands below one at a time.

#### 1. Install the prerequisites

Koinkat is a Tauri app: the interface is web code (needs Node.js) inside
a small native shell (needs Rust and your platform's build tools). The
versions below are the ones this repository's automated builds use and
prove on every change: Node.js 22 and the stable Rust toolchain.

##### Windows

1. **Microsoft C++ Build Tools** - download the Build Tools installer
   from [visualstudio.microsoft.com](https://visualstudio.microsoft.com/visual-cpp-build-tools/)
   and during installation check the **Desktop development with C++**
   workload.
2. **WebView2** - already included in Windows 10 (1803+) and Windows 11.
   Nothing to do on a current system.
3. **Rust** - in PowerShell:

```powershell
winget install --id Rustlang.Rustup
```

   Then close and reopen the terminal and make sure the MSVC toolchain
   is the default:

```powershell
rustup default stable-msvc
```

4. **Node.js 22** - download the LTS installer from
   [nodejs.org](https://nodejs.org/) and run it.
5. **Git** - if you don't have it:

```powershell
winget install --id Git.Git
```

Verify everything (each command prints a version; if one says "not
recognized", close and reopen the terminal first):

```powershell
node --version
```

Expected shape: `v22.x.x`.

```powershell
rustc --version
```

Expected shape: `rustc 1.xx.x`.

```powershell
git --version
```

##### macOS

1. **Xcode Command Line Tools:**

```bash
xcode-select --install
```

2. **Rust:**

```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
```

   Accept the default installation, then close and reopen the terminal.
3. **Node.js 22** - download the LTS installer from
   [nodejs.org](https://nodejs.org/). Git ships with the Command Line
   Tools.

Verify: `node --version` (expect `v22.x.x`), `rustc --version`,
`git --version`.

##### Linux (Debian/Ubuntu)

1. **System libraries** - this is the Tauri-documented set plus the
   extras this repository's automated builds install to build
   successfully:

```bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev patchelf xdg-utils libdbus-1-dev pkg-config
```

2. **Rust:**

```bash
curl --proto '=https' --tlsv1.2 https://sh.rustup.rs -sSf | sh
```

3. **Node.js 22** - distribution packages are often older; follow the
   install instructions on [nodejs.org](https://nodejs.org/) for version
   22 (or use a version manager like nvm).

Verify: `node --version` (expect `v22.x.x`), `rustc --version`,
`git --version`.

#### 2. Get the code and build

```bash
git clone https://github.com/MarcoSburlino/Koinkat.git
```

Downloads the source code into a `Koinkat` folder.

```bash
cd Koinkat
```

Moves the terminal into that folder.

```bash
npm install
```

Installs the JavaScript dependencies (a few minutes; success ends with a
line like `added NNN packages`).

```bash
npm run tauri:build
```

Builds the production app. **The first build compiles the entire Rust
side and takes a while - 10 to 30 minutes is normal.** Later builds
reuse that work and are much faster. Success ends with the bundler
listing the installer files it produced.

#### 3. Find what you built

Installers land under `src-tauri/target/release/bundle/`:

- **Windows:** `bundle\nsis\Koinkat_<version>_x64-setup.exe` and
  `bundle\msi\Koinkat_<version>_x64_en-US.msi`
- **macOS:** `bundle/dmg/Koinkat_<version>_<arch>.dmg` and
  `bundle/macos/Koinkat.app`
- **Linux:** `bundle/appimage/`, `bundle/deb/`, `bundle/rpm/`

Run the installer (your own build triggers the same unsigned-app
warnings as Path A) or, for development, skip installing entirely:

```bash
npm run tauri:dev
```

opens the app in development mode with hot reload and fixture data
("mocks") instead of real bank calls - no credentials needed. See
[docs/development.md](docs/development.md) for the full development
setup, including how to test the real Enable Banking client in dev.

## First run: setting up inside the app

<!-- SCREENSHOT: docs/images/01-first-launch.png - first launch: the user profile (name) step -->

1. **User profile.** On first launch the app shows a single field asking
   for your name. That is the whole "account": no password, no email, no
   online registration. It is a label stored on your computer so the app
   can greet you and support multiple people sharing one machine. It is
   not a login to any online service.
2. **Workspace hub.** Next you land on the workspace hub, where you
   create your first workspace. Every workspace is fully isolated: its
   own bank connections, accounts, categories, budgets, and rules. Two
   cards are offered in the released app:
   - **Connect a bank** - link a real bank through Enable Banking. This
     needs credentials you create in
     [Connecting a bank](#connecting-a-bank), so read that section
     first.
   - **Manual** - track accounts and transactions by hand. No bank, no
     credentials, works immediately.

   You can always add more workspaces later. Starting with a Manual
   workspace and adding a bank-linked one once your Enable Banking
   application is ready is a perfectly good path.

<!-- SCREENSHOT: docs/images/02-workspace-hub.png - workspace hub with the creation cards -->

3. **Workspace basics.** The creation form asks for a workspace name,
   your preferred currency (what totals are converted into), the decimal
   separator you are used to (comma or point), and a light or dark
   theme.
4. **Dashboard.** After creation you land on the Dashboard. The database
   file now exists at the path listed in
   [How Koinkat handles your data](#how-koinkat-handles-your-data).

## Connecting a bank

This is the longest part of setup, so take it step by step; it is a
one-time job of roughly 15 to 20 minutes. Koinkat deliberately ships
with **no bank-access credentials of its own**. You create a personal,
free "application" with Enable Banking, and that application - your ID,
your key - is what authorizes access to your accounts. Nothing is shared
with other users or with the Koinkat project.

By the end of this section you will have three things, and you will have
used them in Koinkat:

1. An Enable Banking **application ID** (a long identifier).
2. A **private key file** ending in `.pem`, downloaded to your computer.
3. An **activated** application, done by linking your own bank account
   once in the Enable Banking portal.

The same steps are also available inside the app: the workspace creation
form has a link named **"Need help getting these? Open the setup
guide"**.

<!-- SCREENSHOT: docs/images/04-bank-setup-guide.png - the in-app Enable Banking setup guide -->

### What Enable Banking is

[Enable Banking](https://enablebanking.com/) is a regulated European
open-banking (PSD2) provider. PSD2 is the EU rule that lets you grant a
third-party app read access to your bank accounts, always with your
explicit consent given on the bank's own website. Koinkat uses Enable
Banking read-only: it can see balances and transactions you authorize,
and it can never move money.

### Step 1: create an Enable Banking account

1. In your browser, go to `enablebanking.com/sign-in/`.
2. Enter your email address and submit.
3. Enable Banking emails you a one-time sign-in link. Open your inbox
   (check the spam folder if nothing arrives within a few minutes) and
   click the link.
4. That is the entire process: there is no password to invent, and your
   account is created automatically the first time you sign in this
   way.

### Step 2: create an API application

1. After signing in you are in the Enable Banking **Control Panel**
   (address: `enablebanking.com/cp/`).
2. In the top menu, open the **API applications** page.
3. Start registering a new application. The registration is one form;
   the next three steps describe the choices it asks for.
4. **Name:** anything you like; it is only a label. Example:
   `Koinkat personal`.
5. **Environment:** choose **Production**. Production means real banks.
   (The other option, Sandbox, is Enable Banking's test environment
   with imitation banks and fake data; its credentials cannot see real
   accounts.)

### Step 3: set the redirect URL

The form asks for one or more **redirect URLs**. Enter exactly this
address:

```text
https://marcosburlino.github.io/koinkat-callback/
```

Copy and paste it rather than typing it, and keep the final `/`. Here is
why this matters: when you later approve access on your bank's website,
the bank sends your browser to this address to deliver a one-time
authorization code back to Koinkat. Enable Banking only allows
redirects to addresses on this list, and it compares them character by
character - a missing slash counts as a different address and the
process stops with an error.

The page at that address is a single static file whose only job is to
hand the code to the Koinkat app on your computer. It stores nothing,
sends nothing anywhere, and its full source is public:
[github.com/MarcoSburlino/koinkat-callback](https://github.com/MarcoSburlino/koinkat-callback).
(If you prefer not to rely on it, you can host your own copy of that
page and register your own address instead; the corresponding field in
Koinkat is editable.)

### Step 4: generate and download your private key

1. The same form asks how to handle the application's **key**. Choose
   the option to **generate** it in the browser.
2. Your browser creates the key locally and downloads the private half
   to your **Downloads** folder. The file is named after your
   application's ID, so it looks like `<your-app-id>.pem` (a long name
   ending in `.pem`).
3. This file is a **private key**: whoever has it, together with your
   application ID, can request your bank data. Treat it like a spare
   house key, calmly but seriously:
   - Move it out of Downloads into a folder you will remember, for
     example a `Koinkat` folder inside your Documents.
   - Never email it, never upload it anywhere, never put it in a
     shared or synced public folder, and if you are a developer, never
     commit it to a repository.
   - Koinkat will ask for this file once, then keep the key in your
     operating system's protected credential storage. Keep the file
     anyway as a backup, for example for setting up a new computer.

### Step 5: note your application ID

After registration the Control Panel shows your application's page,
including its **application ID**: a long identifier of letters and
digits in five groups, like
`aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee` (yours will differ). Copy it or
keep the page open; Koinkat asks for it in Step 6. (It is also the
first part of your downloaded key's filename.)

### Step 6: activate the application by linking your accounts

A newly registered Production application starts **inactive**. For
personal use, Enable Banking activates it when you link your own bank
account through the Control Panel:

1. On your application's page in the Control Panel, use the option to
   **link accounts** (Enable Banking presents this as the way to
   activate an application for personal or testing use).
2. Pick your bank and complete its login and consent screens. This is
   the same kind of bank-approval flow you will later use in Koinkat,
   and it happens entirely on your bank's own website.
3. When it completes, your application is active for personal use with
   the accounts you own. No contract, review, or payment is involved;
   the full commercial activation that Enable Banking offers is only
   for companies providing their application to other people, which is
   not what Koinkat users do.

### Step 7: enter the credentials in Koinkat

<!-- SCREENSHOT: docs/images/03-bank-credentials.png - bank-linked workspace wizard credential fields -->

Now switch to the Koinkat app:

1. In the workspace hub, choose the **Connect a bank** card.
2. Give the workspace a name and pick your preferred currency, decimal
   separator, and theme, as with any workspace.
3. In the **Application ID** field, paste the ID from Step 5.
4. Click **Choose .pem file...** and, in the file dialog, navigate to
   where you moved your key in Step 4 (for example
   Documents > Koinkat) and select the `.pem` file.
5. The **Redirect URL** field is already filled in with the same
   callback address you registered in Step 3:

```text
https://marcosburlino.github.io/koinkat-callback/
```

   **Leave it as it is.** (Only change it if you registered a
   self-hosted page instead.)
6. Confirm. Koinkat immediately checks the credentials against the
   Enable Banking API, so a typo in the ID or a wrong file is caught
   right here - if you get an error, see
   [Troubleshooting](#troubleshooting). On success the workspace is
   created, your key is stored in the operating system's credential
   store (Windows Credential Manager, macOS Keychain, or the Linux
   secret service), and the app takes you straight to the bank-linking
   screen.

### Step 8: link your bank

1. At the top of the Bank Link screen, choose how much history to
   import: the last 30 days, the last 90 days, the maximum (180 days,
   the default), or everything from a specific date.
2. Pick your country from the dropdown, find your bank in the list (a
   search box helps), and click **Connect** next to it.
3. Your regular web browser opens on your bank's authorization page.
   Log in **on your bank's own website** - Koinkat never sees these
   credentials - and approve read access to the accounts you want.
   Most banks confirm with a second factor (an app confirmation or a
   code).
4. After you approve, the bank sends the browser to the callback page,
   which immediately tries to hand the authorization code to the app.
   Your browser asks something along the lines of **"Open Koinkat?"**.
   Click **Allow** / **Open**, and Koinkat finishes the connection by
   itself.
5. **If no prompt appears, or you dismissed it:** that is just as
   normal. The callback page also shows the code with a **Copy Code**
   button. Click it, return to Koinkat, and paste the code into the
   field labeled "Paste authorization code here...", then confirm.
   Both paths end in exactly the same place.

<!-- SCREENSHOT: docs/images/05-consent-flow.png - bank consent page or the callback page with the Open Koinkat prompt -->

6. Koinkat exchanges the code, creates one account in the app per bank
   account you approved, imports the chosen history, and runs its
   categorization engine. **Success looks like:** a "Connected!"
   screen, your accounts with balances on the Dashboard, and imported
   transactions waiting in the Review inbox to be categorized.

### Consent expiry

Bank consents under PSD2 are time-limited: Koinkat requests the maximum
the regulation allows, just under 180 days. When a consent expires, that
bank stops syncing and Settings flags the connection - renew it by
linking the bank again from the Bank Link screen (the same Step 8).
Relinking recognizes the same underlying accounts, so your history and
categorizations are preserved.

## Troubleshooting

**I downloaded the installer but cannot find it.** Browsers save to the
Downloads folder by default. Windows: File Explorer > Downloads, or
press Ctrl+J in the browser to see its download list. macOS: the
Downloads stack in the Dock, or Finder > Downloads. Linux: the Downloads
folder in your file manager.

**Build fails on Windows with `link.exe not found` or a C++ toolchain
error.** The Microsoft C++ Build Tools (or its "Desktop development with
C++" workload) are missing - install them, reopen the terminal, retry.

**Build fails on Linux with `pkg-config` / `webkit2gtk` / `soup`
errors.** A system library from the apt list above is missing - rerun
that install command, then rebuild.

**`node`, `npm`, `rustc`, or `git` is "not recognized".** Either not
installed, or the terminal was open during installation - close and
reopen it. Verify with the version commands above; Node must be v22.x
(older versions fail the build).

**Windows SmartScreen or macOS Gatekeeper blocks the app.** Expected
for unsigned builds - the exact clicks are in
[Path A](#path-a-install-the-released-app), and the background is
explained there under "Why the installers show a security warning".
macOS "damaged" messages are the quarantine flag; the `xattr -cr`
command there clears it.

**Bank linking fails immediately with a redirect URL error
(`REDIRECT_URI_NOT_ALLOWED`).** The redirect URL in Koinkat does not
exactly match a URL registered on your Enable Banking application -
including the trailing slash. Fix the application's redirect URL list in
the Control Panel (or the field in Koinkat Settings) so both are exactly
`https://marcosburlino.github.io/koinkat-callback/`.

**Credential verification fails when creating the workspace.**
"Doesn't look like a valid private key" means the selected file is not
the private `.pem` you downloaded. A 401 or 403 error from Enable
Banking means the application ID and key do not match, or the
application is not activated yet - re-check the ID, that you picked the
right `.pem`, and the application's activation status in the Control
Panel (see Step 6).

**The "Open Koinkat?" prompt never appears.** Some browsers suppress
custom-protocol prompts. Use the copy-paste path on the callback page -
it is fully supported, not a degraded mode. If Koinkat is freshly
installed and the prompt is never offered at all, launch Koinkat once
and retry (the app registers its `koinkat://` link handler at startup).

**Connected, but no transactions.** First check the Review inbox -
imports land there for categorization, not directly in Transactions.
Then check the import window you chose (a 30-day window on a quiet
account may genuinely be empty). Some banks also reject the
pending-transactions filter; Koinkat then imports booked transactions
only and notes it - pending ones appear once booked.

**Sync fails with a rate-limit message.** PSD2 allows roughly four
unattended data pulls per account per day; Koinkat's normal sync uses
three of them. If you hit the limit, the next day's sync proceeds
normally.

**Settings says the key is stored in the database, not the keychain.**
No OS credential store was reachable (common on minimal Linux setups:
install and unlock GNOME Keyring or KWallet, then re-save the
credentials in Settings). The app keeps working either way; the
keychain is simply the safer location.

**Net worth shows "could not reconcile" or missing conversions.** The
daily exchange-rate fetch failed (offline, or the CDN was unreachable).
The Dashboard offers a refresh; rates are cached per day once fetched.

## Build modes

Three modes, each producing a verifiably different bundle:

| Mode | Command | Mocks | `/rules` route | Sandbox card | Tauri ID |
|---|---|---|---|---|---|
| Development | `npm run tauri:dev` | on | visible | visible | `com.koinkat.app` |
| Demo | `npm run tauri:build:demo` | on | hidden | visible | `com.koinkat.app.demo` |
| Production | `npm run tauri:build` | **build fails if leaked** | removed | hidden | `com.koinkat.app` |

Demo installs side-by-side with production (different identifier). See
[`docs/development.md`](docs/development.md) for the full setup and the
three-layer defense that keeps mocks out of production binaries.

## Stack

Tauri 2 (Rust shell) · React 19 + TypeScript 5.7 · Vite 6 · Tailwind CSS 4
· SQLite via `tauri-plugin-sql` · Zustand 5 · Recharts 2 · big.js for
all money math · `jose` for Enable Banking RS256 JWTs.

## Security model

Koinkat is local-first; the trust boundary is your machine.

- **All data is stored locally** in a SQLite database under your OS
  app-config directory. The database is **not encrypted at rest** - rely
  on OS disk encryption (BitLocker / FileVault / LUKS) if you need it.
  Anyone with access to your OS user account can read your financial data.
- **Your Enable Banking private key** is stored in the operating system's
  credential store (Windows Credential Manager, macOS Keychain, Linux
  secret service), not in the database. If no credential store is
  available, Koinkat falls back to the local database and says so in
  Settings.
- **Exports:** the JSON export deliberately excludes API credentials. The
  raw-database export is a full backup - treat the file like the database
  itself.
- **Network:** the content-security policy allows data connections only
  to `api.enablebanking.com` and the exchange-rate CDN
  (`cdn.jsdelivr.net`, `*.currency-api.pages.dev`), plus Google Fonts
  for the app's typefaces. The complete outbound inventory is in
  [How Koinkat handles your data](#how-koinkat-handles-your-data).
  There is no telemetry endpoint to allow.
- **OAuth:** the bank-link deep-link callback validates a cryptographically
  random state; missing or mismatching states are rejected.
- Release binaries are built without the webview devtools feature.

Found a vulnerability? See [SECURITY.md](SECURITY.md).

## Repository layout

```
Koinkat/
├── src/                    Frontend (React + TypeScript)
│   ├── pages/              Route components
│   ├── components/         UI components + layout
│   ├── services/           Business logic; the only layer that talks to the DB
│   ├── stores/             Zustand stores
│   ├── domain/             Pure helpers (money math, merchant normalization)
│   ├── lib/                Cross-cutting utilities
│   ├── types/              TypeScript types + row→model mappers
│   ├── db/                 SQL schema + incremental migrations (v2 → v8)
│   ├── data/               Static data (MCC mappings)
│   └── mocks/              Fixture-backed Enable Banking stub (dev/demo only)
├── src-tauri/              Tauri Rust shell + config
├── docs/                   Public documentation (architecture, dev guide, audit)
└── .agent/                 AI agent knowledge base (gitignored, local-only)
```

## Documentation

- [`docs/architecture.md`](docs/architecture.md) - system layers, services,
  cross-cutting patterns, build flags, Tauri host.
- [`docs/development.md`](docs/development.md) - running, building,
  three-build-mode setup, migrations recipe, conventions.
- [`docs/restructure-audit.md`](docs/restructure-audit.md) - historical
  audit of the pre-publication restructure (2026-04-24) and follow-up.

Don't see what you're looking for? Open an issue.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, the project invariants
(money math, workspace isolation, mock containment), and the PR
checklist. Community expectations live in
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md); release history in
[CHANGELOG.md](CHANGELOG.md).

## License

Koinkat is free software: you can redistribute it and/or modify it under
the terms of the GNU General Public License as published by the Free
Software Foundation, either version 3 of the License, or (at your option)
any later version (GPL-3.0-or-later).

Copyright (C) 2026 Marco Sburlino

See [LICENSE](LICENSE) for the full text.
