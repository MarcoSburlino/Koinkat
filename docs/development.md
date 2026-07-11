# Development

A practical reference for building, running, and contributing to Koinkat.

For a high-level map of the codebase, read [`architecture.md`](./architecture.md).
For the history of the public-distribution restructure, read
[`restructure-audit.md`](./restructure-audit.md).

## Prerequisites

- **Node.js** >= 20 (Vite 6 + React 19 baseline).
- **Rust** stable + the platform Tauri toolchain prerequisites
  (see <https://v2.tauri.app/start/prerequisites/>).
- **npm** for package management. `package-lock.json` is committed.

No global Tauri CLI is needed - `@tauri-apps/cli` is a dev dependency and is
invoked through `npm run tauri:*` scripts.

## Three build modes

Koinkat ships with three Vite build modes. Each one flips a set of
compile-time flags in `vite.config.ts` that control what code reaches the
bundle.

| Mode | Command | Mocks | Debug routes | Sandbox UI | Tauri identifier |
|---|---|---|---|---|---|
| `development` | `npm run dev` / `npm run tauri:dev` | On by default | Visible | Visible | `com.koinkat.app` |
| `demo` | `npm run build:demo` / `npm run tauri:build:demo` | On by default | Hidden | Visible | `com.koinkat.app.demo` |
| `production` | `npm run build` / `npm run tauri:build` | **Build fails if present** | Removed | Hidden | `com.koinkat.app` |

### What each flag controls

Defined in `vite.config.ts` via Vite's `define`, declared in
`src/vite-env.d.ts`. At build time Vite replaces each occurrence with the
literal `true` or `false`; Rollup then tree-shakes any branch (and its
imports) where the literal is `false`.

| Flag | dev | demo | prod | Purpose |
|---|---|---|---|---|
| `__KOINKAT_ALLOW_MOCKS__` | `true` | `true` | `false` | Whether `src/mocks/` may be imported at all |
| `__KOINKAT_EB_MOCK_DEFAULT__` | `true` | `true` | `false` | Whether the dispatcher in `src/services/enable-banking-service.ts` actually routes to the mock |
| `__KOINKAT_ALLOW_DEBUG_ROUTES__` | `true` | `false` | `false` | Whether `/rules` is registered in the router |
| `__KOINKAT_ALLOW_SANDBOX_UI__` | `true` | `true` | `false` | Whether the Sandbox card is rendered in the workspace-creation hub |

The sandbox **runtime** stays intact across all modes - existing users with
sandbox workspaces keep working after a production build. Only the "create
a new sandbox workspace" UI surface is gated.

### Three-layer defense that mocks never reach production

1. **Compile-time flag replacement** - Vite replaces `__KOINKAT_ALLOW_MOCKS__`
   with the literal `false` in production, and Rollup tree-shakes every
   guarded branch + its imports.
2. **Mock-default flag** - `__KOINKAT_EB_MOCK_DEFAULT__` is also `false` in
   production, so even if the guard flag misfired, `IS_MOCK` would still be
   `false`.
3. **Post-bundle scan** - `forbidMocksInProductionBundle` in `vite.config.ts`
   fails the build if any chunk's `moduleIds` contain `/src/mocks/` or
   `\src\mocks\`.

## Commands

| Script | Purpose |
|---|---|
| `npm run dev` | Vite dev server, port 1420. Typically run via `npm run tauri:dev`. |
| `npm run tauri:dev` | Full desktop dev - Vite + Tauri window with hot reload. |
| `npm run build` | Production bundle (`tsc && vite build --mode production`). |
| `npm run build:demo` | Demo bundle (`tsc && vite build --mode demo`) with mocks on for tutorials / marketing. |
| `npm run tauri:build` | Production Tauri installer. |
| `npm run tauri:build:demo` | Demo Tauri installer (`com.koinkat.app.demo`), installable side-by-side with production. |
| `npm run preview` | `vite preview` - serve `dist/` for manual QA. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run test` | Vitest run once. Today only covers `src/domain/money.ts`. |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run test:ui` | `@vitest/ui` dashboard. |

No linter is configured. `npm run typecheck` is the only static gate;
run it after editing any typed file.

### Testing

Vitest 4.1.5 is installed. The only test file today is
`src/domain/money.test.ts` (42 tests covering `dec`, `qCent`, `qRate`,
`convertAmount`, `tryConvert`, `requirePositiveAmount`,
`requireNonNegativeAmount`, plus a rounding-mode regression that pins
half-up rounding). Tests sit beside the file they cover; vitest's
default include glob picks them up automatically.

Expanding coverage beyond money math is on the list - see
`restructure-audit.md` "Still open".

## Testing the real Enable Banking client in dev

Dev mode defaults to mocks-on so contributors don't need credentials. To
exercise the real client:

1. Open `vite.config.ts`.
2. Change `const mocksOnByDefault = mode === "development" || mode === "demo";`
   to `const mocksOnByDefault = mode === "demo";`.
3. Restart `npm run tauri:dev`.
4. In the Connection page (account hub), pick **Linked**, drop your Enable
   Banking application `.pem`, and paste the matching `app_id` UUID.

Revert the `vite.config.ts` change before committing.

## Environment variables

There are no committed `.env*` files. The `.gitignore` blocks `.env` and
`.env.*` entirely - all build-mode behavior is driven by the Vite `mode` at
build time. If you need a local variable (e.g. `TAURI_DEV_HOST` for LAN
mobile testing), create `.env.local`; it stays gitignored.

## OAuth callback

The Enable Banking authorization flow requires a publicly-reachable
redirect URL. Koinkat uses a static GitHub Pages page checked into this
repo at `docs/callback/index.html`. It receives `?code=…` from Enable
Banking and presents the code for the user to paste back into the desktop
app. The default redirect is hardcoded in
`src/lib/constants.ts` (`OAUTH_CALLBACK_URL = 'koinkat://auth-callback'`)
for the deep-link path; the database column `api_configs.redirect_url`
defaults to `https://marcosburlino.github.io/koinkat-callback/` for the
browser-mediated path.

If you fork the project, swap both URLs to your own callback host. The
Tauri deep-link plugin is registered for the `koinkat://` scheme in
`src-tauri/tauri.conf.json`.

## Database & migrations

The SQLite database file is opened by `@tauri-apps/plugin-sql` at the path
`sqlite:koinkat.db` (handled in `src/db/database.ts`). It lives in the
platform's per-app data directory (e.g. `%APPDATA%\com.koinkat.app` on
Windows).

Schema files:

- `src/db/schema-v2.sql` - current schema (`users`, `koinkat_accounts`,
  `accounts`, `transactions`, `categories`, `bank_connections`,
  `linked_accounts`, `api_configs`, `exchange_rates`, plus the
  budget / split tables).
- `src/db/schema.sql` - legacy v1 schema, kept for reference.
- `src/db/migration-v2.sql` … `migration-v8.sql` - incremental DDL applied
  in order on every app boot.

Migrations are managed through Tauri's SQL plugin migration runner.
**Always create a new `migration-vN.sql` rather than editing an existing
one** - installed apps replay missing migrations on next launch, but never
re-run ones that already succeeded.

## Money & exchange rates

- All monetary values are stored and computed as `big.js` decimals via the
  helpers in `src/domain/money.ts` (`dec`, `qCent`, `qRate`, `convertAmount`,
  `tryConvert`). Never use `number` arithmetic for amounts - it's why
  `dec()` rejects `number` at runtime.
- Cross-currency totals use USD as a pivot via the
  fawazahmed0 currency-api JSON files. Primary host is
  `cdn.jsdelivr.net`, fallback is `*.currency-api.pages.dev`. Both are
  whitelisted in the Tauri CSP (`src-tauri/tauri.conf.json`).
- Daily rates are cached in the `exchange_rates` table and refreshed by
  `ensureTodayRates()` on Shell bootstrap and before every bank sync.

## Style & conventions

- TypeScript strict mode (`tsconfig.json`). No `any` outside narrowly
  scoped DTOs.
- React 19 functional components only. Stores use Zustand (`src/stores/`).
- Routing through `react-router-dom` v7. The Shell renders `<Outlet />`;
  every routed page sits inside it. Non-routed views (`UserRegister`,
  `UserLogin`, `Connection`) are rendered conditionally by the Shell based
  on bootstrap state.
- Styling: Tailwind v4 via `@tailwindcss/vite` and `src/index.css`. Theme
  tokens come from CSS variables (`--bg`, `--text-muted`, …), set via the
  `data-theme` attribute on `<html>`.
- Snake-case database rows, camelCase domain types. Mappers live alongside
  the types in `src/types/models.ts` (`toAccount`, `toTransaction`, …).

## Git hygiene

- `junk/` is the on-disk quarantine for old prototypes, personal notes,
  and the `.pem` keys that previously sat at the repo root. Gitignored.
- `.agents/`, `.claude/`, and `AGENTS.md` are gitignored. Never commit
  internal planning docs.
- `*.pem`, `*.key`, `*.p8`, `*.p12`, and the well-known credential
  filenames (`credentials.json`, `secrets.json`, …) are gitignored. If
  you ever need to share a key, do it out-of-band.

## Adding a new dev-only surface

Pick the right flag for the visibility you want:

```tsx
// New debug route (visible in development only):
{__KOINKAT_ALLOW_DEBUG_ROUTES__ && (
  <Route path="my-debug-page" element={<MyDebugPage />} />
)}

// New UI element that should appear in dev + demo but not production:
{__KOINKAT_ALLOW_SANDBOX_UI__ && <MyDevOnlyCard />}
```

For a brand-new visibility class (e.g. an "admin" tier), add a fourth
boolean to the `define` block in `vite.config.ts`, declare it in
`src/vite-env.d.ts`, and gate uses with `if (__KOINKAT_ALLOW_…__) { … }`.

## Pre-release blockers

See [`restructure-audit.md`](./restructure-audit.md) "Still open" section
for the items that must be resolved before a public 1.0 release. As of
2026-05-16:

- **Resolved** (since the 2026-04-28 follow-up): bundle metadata
  icons (32 / 128 / 128@2x / .icns / .ico), category, short / long
  description populated in `tauri.conf.json`; `copyright` / `publisher`
  / `homepage` filled. CSP includes the jsDelivr CDN that `fx-fetch.ts`
  needs as its primary FX host. Top-level React error boundary in
  place; its GitHub-issues link points at the real repo. Money-math
  test suite added. Minimal root `README.md` added.
- **Still open**: no code-signing identity / notarization profile.
  No LICENSE file (deferred until publication strategy is decided).
  Test suite now covers money math, sync fallbacks, categorization, recurring matching, and keychain storage. No linter. CI + release workflows added 2026-07-02 (see below).

## CI and releases (added 2026-07-02)

- **CI** (`.github/workflows/ci.yml`) runs on every push/PR: a version
  consistency check (package.json / tauri.conf.json / Cargo.toml must
  match), `npm run typecheck`, `npm run test`, the production bundle
  (which includes the mock-leak scanner), and `cargo check` on Ubuntu,
  Windows, and macOS. The three-OS Rust matrix exists because the shell
  has platform-conditional code (keychain backends, single-instance,
  deep-link registration).
- **Releases** (`.github/workflows/release.yml`): push a `vX.Y.Z` tag and
  the workflow builds installers for all three platforms via
  `tauri-apps/tauri-action` and attaches them to a DRAFT GitHub release
  for manual review. Builds are unsigned until signing secrets are
  configured (see the comments in the workflow).
- **Dependencies**: Dependabot watches npm, cargo, and the workflow
  actions weekly (`.github/dependabot.yml`).
- Release steps for maintainers live in `CONTRIBUTING.md`.
