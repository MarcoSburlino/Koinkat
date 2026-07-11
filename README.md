# Koinkat

[![CI](https://github.com/MarcoSburlino/Koinkat/actions/workflows/ci.yml/badge.svg)](https://github.com/MarcoSburlino/Koinkat/actions/workflows/ci.yml)

Local-first multi-currency personal finance manager. Built as a Tauri 2
desktop app. All data stays on your device - no cloud, no telemetry, no
accounts system.

> **Status:** pre-release. The app builds and runs; expect rough edges
> while the release process is finalised.

<!-- TODO(screenshots): add 2-3 screenshots or a short GIF here, taken
     from the demo build (fixture data, nothing personal). Suggested:
     Dashboard, Review inbox, Budgets. -->

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

## Stack

Tauri 2 (Rust shell) · React 19 + TypeScript 5.7 · Vite 6 · Tailwind CSS 4
· SQLite via `tauri-plugin-sql` · Zustand 5 · Recharts 2 · big.js for
all money math · `jose` for Enable Banking RS256 JWTs.

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

## Install

Prebuilt installers for Windows, macOS, and Linux are attached to each
[GitHub release](https://github.com/MarcoSburlino/Koinkat/releases).

> **Note:** builds are currently **unsigned**. Windows SmartScreen will
> warn ("Windows protected your PC" - choose "More info" > "Run anyway"),
> and macOS Gatekeeper requires right-click > Open on first launch. If
> that makes you uncomfortable, build from source below - it's the same
> code.

## Quick start (from source)

```bash
# 1. Install prerequisites: Node.js 20+, Rust stable toolchain
#    (see https://v2.tauri.app/start/prerequisites/)

# 2. Clone and install
git clone https://github.com/MarcoSburlino/Koinkat.git
cd Koinkat
npm install

# 3. Run the dev app (mocks on by default - no real bank credentials needed)
npm run tauri:dev
```

To exercise the real Enable Banking client in dev, follow the recipe in
[`docs/development.md`](docs/development.md#testing-the-real-enable-banking-client-in-dev).

## Connecting your bank

Koinkat ships **no API credentials**. To link a real bank you create your
own (free) Enable Banking application - the in-app setup guide walks
through every step:

1. Sign up at enablebanking.com and register an application.
2. Generate an RS256 key pair; upload the public key to your application.
   The private `.pem` never leaves your machine.
3. Register Koinkat's shared **callback page** as your application's
   redirect URL: `https://marcosburlino.github.io/koinkat-callback/`
   (exact match, trailing slash included). The page is generic and holds
   no secrets - it just bounces the OAuth code to the
   `koinkat://auth-callback` deep link, and an intercepted code is
   useless without your private key. Prefer full independence? Host your
   own copy of [koinkat-callback](https://github.com/MarcoSburlino/koinkat-callback)
   and register that URL instead - the field in Koinkat is editable.
4. In Koinkat, create a bank-linked workspace and enter your application
   ID, private key file and redirect URL.

Heads-up on environments: the Enable Banking **sandbox** works with a
free account out of the box. **Production** access (real banks) is
subject to Enable Banking's own activation/agreement process for your
application - check their terms and Control Panel for the current
requirements.

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
- **Network:** the content-security policy allows connections only to
  `api.enablebanking.com` and the exchange-rate CDN (`cdn.jsdelivr.net`,
  `*.currency-api.pages.dev`). There is no telemetry endpoint to allow.
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
