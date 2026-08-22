# Koinkat privacy policy

Effective date: 2026-08-22

This policy covers the Koinkat desktop application (Windows, macOS,
Linux) published from this repository by Marco Sburlino.

## The short version

Koinkat is a local-first application. All of your data stays on your
device. The developer operates no server and does not collect, receive,
store, or process any personal or financial data. There is no telemetry,
no analytics, no crash reporting, no cloud sync, and no user account.

## Data the app stores, and where

- **Financial data you enter or import**: workspaces, accounts,
  balances, transactions, budgets, categories, and categorization
  rules. Stored in a SQLite database in your OS application-data
  folder:
  - Windows: `C:\Users\<you>\AppData\Roaming\com.koinkat.app`
  - macOS: `~/Library/Application Support/com.koinkat.app`
  - Linux: `~/.config/com.koinkat.app`
- **Bank connection credentials** (present only if you link a bank):
  the private key of your own Enable Banking API application is stored
  in the operating system credential store (Windows Credential Manager,
  macOS Keychain, Linux secret service) under the service name
  `koinkat`. If no credential store is available, Koinkat stores the
  key in the local database and says so in Settings.
- **Application settings**, stored in the same local folder.

The database is not encrypted at rest; use OS disk encryption
(BitLocker, FileVault, LUKS) if you need protection from other users
of your machine.

## Network connections the app makes

Koinkat connects to exactly two services, plus your own bank through
your browser:

1. **Enable Banking API** (`api.enablebanking.com`), only when you
   connect a bank. Koinkat uses read-only account information access
   (PSD2 AIS) through an API application that you register yourself
   with Enable Banking. Requests are signed with your own private key.
   The app cannot initiate payments or transfers. Account, balance,
   and transaction data returned by the API is written only to your
   local database. Enable Banking processes this traffic as a
   regulated PSD2 provider under its own privacy notice:
   <https://enablebanking.com/privacy/>
2. **Exchange rates**, from a public CDN (`cdn.jsdelivr.net`, package
   `@fawazahmed0/currency-api`, with `*.currency-api.pages.dev` as a
   fallback). These requests download currency rate tables and contain
   no personal data.
3. **Bank authorization** happens in your browser, on your bank's own
   pages. Koinkat never sees your online banking username or password.
   After you give consent at your bank, the bank redirects to a static
   callback page (by default
   `https://marcosburlino.github.io/koinkat-callback/`, source at
   <https://github.com/MarcoSburlino/koinkat-callback>) whose only job
   is to hand the authorization code back to the app on your device.
   The page is a single static file; it makes no network requests and
   stores nothing.

There are no other outbound connections.

## What the developer receives

Nothing. No personal data, no financial data, no usage data, no error
reports. Error details shown by the app stay on your screen unless you
choose to copy them into a bug report yourself.

## Retention and deletion

Everything lives in files on your device, under your control:

- Deleting a workspace inside the app removes that workspace's data
  from the local database and deletes its credential-store entry.
- To remove everything, uninstall the app, delete the application-data
  folder listed above, and remove any credential-store entries under
  the service name `koinkat` (one entry per workspace, named
  `eb-pem-<workspace-id>`). The README section "Uninstalling" walks
  through this per operating system.
- Bank consents expire on their own after just under 180 days and can
  be revoked earlier through your bank or through Enable Banking.

## Changes to this policy

Changes are made by commits to this file, so its full history is
public in the repository.

## Contact

Open an issue at <https://github.com/MarcoSburlino/Koinkat/issues>.
