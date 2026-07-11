# Architecture

A high-level map of how Koinkat is wired together. Companion to
[`development.md`](./development.md), which is the practical
contributor guide.

Koinkat is a desktop-first personal finance app. Every byte of user data
lives locally in a SQLite file managed by the Tauri SQL plugin; the only
network calls go to Enable Banking (PSD2 account aggregation) and a public
exchange-rate JSON CDN. There is no server.

## Stack

| Layer | Choice |
|---|---|
| Desktop shell | Tauri v2 (Rust) |
| UI | React 19 + TypeScript 5.7 + Tailwind v4 |
| Bundler | Vite 6 (with three `mode`-driven build profiles) |
| Routing | `react-router-dom` v7 |
| State | Zustand (5 stores) |
| DB | SQLite via `@tauri-apps/plugin-sql` |
| Money | `big.js` (no floats touch amounts) |
| HTTP | `@tauri-apps/plugin-http` (CSP-controlled native fetch) |
| JWT | `jose` (Enable Banking RS256) |
| Charts | Recharts |

The Rust shell is intentionally thin - `src-tauri/src/lib.rs` registers
plugins and runs the webview. All business logic is in TypeScript. The one
app-defined command set is `src-tauri/src/secrets.rs`: `secret_set` /
`secret_get` / `secret_delete`, thin wrappers over the `keyring` crate that
store the Enable Banking private key in the OS credential store (Windows
Credential Manager / macOS Keychain / Linux secret service). The service
name is fixed to `"koinkat"` on the Rust side so the webview cannot touch
foreign credentials.

## Layout

```
src/
├── App.tsx                # <BrowserRouter> + the Shell + child routes
├── main.tsx               # ReactDOM.createRoot bootstrap
├── index.css              # Tailwind + CSS-variable theming
├── vite-env.d.ts          # Compile-time flag declarations
├── assets/                # Static images
├── components/
│   ├── layout/            # Shell, Sidebar, Header, PageHeader
│   ├── ui/                # Button, Card, Input, Modal, Select, etc.
│   └── BankSetupGuide.tsx # First-run linked-mode walkthrough
├── data/
│   └── mcc-mappings.ts    # Static MCC → category seed table
├── db/
│   ├── database.ts        # `getDb()` - singleton handle
│   ├── schema.sql         # Legacy v1 schema (reference only)
│   ├── schema-v2.sql      # Current schema
│   ├── migration-v2…v8.sql# Incremental migrations
│   └── seed.ts            # Default categories + MCC rule seeding
├── domain/                # Pure helpers (no React, no DB)
│   ├── money.ts           # big.js wrappers + tryConvert
│   ├── currencies.ts      # ISO list + symbols
│   ├── colors.ts          # Account/budget color palette
│   └── merchant.ts        # `normalizeMerchantName`
├── hooks/
│   └── useClipboard.ts
├── lib/
│   ├── active-koinkat-account.ts  # localStorage active-id helpers
│   ├── active-user.ts             # localStorage active-id helpers
│   ├── budget-colors.ts
│   ├── chart-style.ts
│   ├── constants.ts               # OAUTH_CALLBACK_URL
│   ├── format.ts                  # Locale-aware money/date formatting
│   └── fx-fetch.ts                # Currency API client (with fallback)
├── mocks/                 # FIXTURE-BACKED Enable Banking stub
│   ├── eb_mock_fixtures.json
│   └── mock-enable-banking-service.ts
├── pages/                 # Route components (1-1 with App.tsx routes)
├── services/              # Domain services (see below)
├── stores/                # Zustand slices (see below)
└── types/
    ├── enums.ts           # String-literal unions
    ├── models.ts          # Domain interfaces + DB row types + mappers
    └── categorization.ts  # Engine-internal types
```

## State hierarchy

The app resolves a four-state user flow on bootstrap:

```
no users               → UserRegister
users, no active       → UserLogin
active user, no active workspace → Connection (account hub)
active user + active workspace   → routed app (Outlet)
```

Logic lives in `src/components/layout/Shell.tsx::bootstrap`. Active IDs
are persisted in `localStorage` (`active-user`, `active-koinkat-account`)
and rehydrated on launch.

```
User
└── KoinkatAccount  (workspace = preferences + connection_type)
    ├── Account     (manual or bank-linked, has currency + balance)
    ├── Category    (system macros + user subcategories)
    ├── Tag         (income/expense legacy classification)
    ├── BudgetEvent
    ├── RecurringBudget → BudgetPeriod
    ├── BankConnection  → LinkedAccount → Account
    ├── ApiConfig       (Enable Banking app_id + private_key_pem)
    └── Transaction
        └── SplitExternalReimbursement (rails the user doesn't track as accounts)
```

Cascading deletes for a workspace or user are handled at the **service
layer** (`koinkat-account-service.deleteKoinkatAccount`,
`user-service.deleteUser`) - SQLite foreign keys only cover intra-workspace
parent/child relations.

## Stores

All in `src/stores/`. Each is a small Zustand slice - no middleware, no
persistence library. Persistence (when needed) is done by hand against
`localStorage`.

| Store | Holds | Notes |
|---|---|---|
| `user-store.ts` | List of users + active user | `setActive` clears the active-koinkat-account so a user switch always lands in the hub. |
| `koinkat-account-store.ts` | List of workspaces + active workspace | Calls `ensureKoinkatAccountSeeded(id)` on activation so pre-v4 workspaces get categories + MCC rules on first re-entry. |
| `app-store.ts` | App-level settings (currency, theme, decimal separator), `pendingReviewCount` for the Sidebar/Dashboard badge | Settings are mirrored from the active workspace. |
| `bank-store.ts` | List of bank connections, sync state, `isConfigured`, `isDemoMode` | Wraps `bank-sync-service` so the UI can call `startSync`, `startFullResync`, `startFullResyncOverride`, `startPullOlderHistory`. |
| `ui-store.ts` | Sidebar open/closed, privacy mode | Privacy mode is the only `localStorage`-backed UI flag. |

## Services

All in `src/services/`. A service is a stateless module that talks to the
DB and exposes async functions. Stores call services; pages call services
directly for one-off reads/writes.

| Service | Role |
|---|---|
| `user-service` | CRUD users + cross-workspace cascades. |
| `koinkat-account-service` | CRUD workspaces + per-workspace cascade. Owns workspace seeding. |
| `account-service` | Manual + linked bank accounts (currency, balance, pinned, color). |
| `transaction-service` | Income/expense/transfer rows. Owns the split-expense lifecycle and FX-aware balance maintenance. |
| `transfer-detection-service` | Matches income↔expense pairs across accounts that look like transfers; surfaces them in the Review queue. |
| `category-service` | Categories + the system macros. `categorization-service` consumes this. |
| `categorization-service` | Three-stage rule engine (user → learned → MCC). Populates `categorization_source`, `merchant_normalized`, `needs_review`. |
| `rule-service` | CRUD over `categorization_rules` (Rules debug page + automatic learning from user confirmations). |
| `budget-service` | Budget events, recurring budgets, budget periods. |
| `reporting-service` | Aggregations powering Analysis, Summary, Dashboard charts. |
| `settings-service` | Per-workspace settings persistence. |
| `api-config-service` | Per-workspace Enable Banking credentials (`app_id`, `private_key_pem`, `environment`, `redirect_url`, `is_demo_mode`). |
| `enable-banking-service` | **Dispatcher.** Single public entry point; routes to mock or real client based on compile-time flags. |
| `enable-banking-service-real` | Real PSD2 client (RS256-signed JWTs via `jose`, HTTP via Tauri plugin). |
| `bank-sync-service` | Orchestrates `listBanks → startAuthorization → handleAuthCallback → createSession → getBalances/getTransactions`. Calls into the categorization engine post-import. |
| `exchange-rate-service` | Daily fetch + DB cache for the `exchange_rates` table. Backed by `lib/fx-fetch.ts`. |
| `demo-service` | Runtime helpers for the **sandbox** workspace type (`isSandboxMode`, `deactivateSandbox`). Production code despite the name. |

`demo-service.ts` is named historically - it predates the dev/demo/prod
build split. It implements the legitimate user-facing **sandbox**
workspace, not mock mode. Renaming is a low-priority cleanup.

## Enable Banking dispatcher

`src/services/enable-banking-service.ts` is the only public entry point
for any bank-API call. It exists so the page layer (`BankLink.tsx`,
`Review.tsx`) and `bank-sync-service.ts` can call the same functions
regardless of build mode.

The dispatcher:

1. Holds `IS_MOCK = __KOINKAT_ALLOW_MOCKS__ && __KOINKAT_EB_MOCK_DEFAULT__`.
   In production both flags are `false`, so the constant is `false` and
   every guarded `if (IS_MOCK)` branch is dead code.
2. Branches per function (`listBanks`, `startAuthorization`,
   `createSession`, `getBalances`, `getTransactions`, `getSessionStatus`,
   `deleteSession`, `verifyCredentials`).
3. Normalizes the mock fixture's snake_case shape to the real client's
   camelCase shape before returning.

The mock module under `src/mocks/` is therefore never reached from any
non-dispatcher import - and the post-bundle scanner in `vite.config.ts`
fails the production build if any chunk lists a `src/mocks/` module ID.

## Routing

```
<Shell>
├── /                      Dashboard
├── /accounts/create       AccountCreate
├── /accounts/:id/edit     AccountEdit
├── /transactions          TransactionList
├── /transactions/create   TransactionCreate
├── /transactions/transfer TransactionTransfer
├── /transactions/:id/edit TransactionEdit
├── /transactions/:id/split TransactionSplit
├── /categories            Categories
├── /review                Review (categorization queue)
├── /rules                 Rules               (dev only - gated by __KOINKAT_ALLOW_DEBUG_ROUTES__)
├── /analysis              Analysis
├── /summary               Summary
├── /budgets               Budgets
├── /budget-events         → redirect to /budgets (legacy, 2026-04-22)
├── /bank-link             BankLink
└── /settings              Settings
```

`Connection` (the account hub) is **not** a route - it sits outside the
sidebar shell. Shell renders it directly when `view === 'accountHub'`.

## Money & FX

- `src/domain/money.ts` is the only place `big.js` is configured
  (`Big.RM = roundHalfUp; Big.DP = 20`). Everything else goes through
  `dec`, `qCent`, `qRate`.
- `convertAmount` throws on missing rates; `tryConvert` returns `null`.
  Aggregation queries (Dashboard, Analysis, Summary) use `tryConvert`
  and surface a "could not reconcile X rows" flag rather than silently
  adding raw amounts to the wrong-currency total.
- Rates pivot through USD: `cross_rate = toRate / fromRate`, where each
  rate is "1 USD in the target currency".
- `lib/fx-fetch.ts` calls `cdn.jsdelivr.net/npm/@fawazahmed0/currency-api`
  first and falls back to `*.currency-api.pages.dev`. Both are whitelisted
  in the Tauri CSP.
- `services/exchange-rate-service.ts` caches the daily `usd.json` payload
  in the `exchange_rates` table keyed by `rate_date`. `ensureTodayRates()`
  is called on Shell bootstrap and before every sync.

## Tauri layer

`src-tauri/`:

- `tauri.conf.json` - the production + dev config. Window 1280×800
  (min 900×600), strict CSP, deep-link scheme `koinkat://`,
  preloaded SQLite `sqlite:koinkat.db`.
- `tauri.conf.demo.json` - a thin override merged on top via `-c`.
  Sets `productName: "Koinkat Demo"`, `identifier: "com.koinkat.app.demo"`,
  `beforeBuildCommand: "npm run build:demo"`. Side-by-side install with
  production.
- `Cargo.toml` - Rust deps are entirely Tauri plugin crates: `sql`,
  `http`, `fs`, `dialog`, `shell`, `deep-link`, `single-instance`. No
  direct `reqwest`, no crypto crate. JWT signing happens in JS via `jose`;
  HTTP goes through the plugin so CSP applies.
- Capability files under `src-tauri/capabilities/` declare which
  commands/plugins each window may call.

## Compile-time flag plumbing (end-to-end)

```
vite.config.ts (define):
    __KOINKAT_ALLOW_MOCKS__       : true (dev,demo)  | false (prod)
    __KOINKAT_EB_MOCK_DEFAULT__   : true (dev,demo)  | false (prod)
    __KOINKAT_ALLOW_DEBUG_ROUTES__: true (dev only)  | false (demo,prod)
    __KOINKAT_ALLOW_SANDBOX_UI__  : true (dev,demo)  | false (prod)

src/vite-env.d.ts: declare const __KOINKAT_…__: boolean;

Consumers:
    src/services/enable-banking-service.ts → ALLOW_MOCKS + EB_MOCK_DEFAULT
    src/pages/BankLink.tsx                 → ALLOW_MOCKS + EB_MOCK_DEFAULT
    src/pages/Review.tsx                   → ALLOW_MOCKS + EB_MOCK_DEFAULT
    src/App.tsx                            → ALLOW_DEBUG_ROUTES
    src/pages/Connection.tsx               → ALLOW_SANDBOX_UI

Defense layers in production:
  1. Vite replaces literal → Rollup tree-shakes guarded branches and the
     `mockService` namespace import.
  2. Both flag literals are `false`, so even an un-tree-shaken `IS_MOCK`
     evaluates to `false`.
  3. `forbidMocksInProductionBundle` plugin scans every emitted chunk's
     `moduleIds` and aborts the build if any `/src/mocks/` slips through.
```
