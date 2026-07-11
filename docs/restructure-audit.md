# Koinkat Restructure Audit

**Date:** 2026-04-24
**Scope:** Read-only audit of the repo state before restructuring for public distribution.
**Repo root:** `C:\Users\marco\OneDrive\Desktop\Koinkat`

---

## 1. Files to Remove Entirely

### Must-delete (security / clearly junk)
Add these files to a folder called junk and add that to the .gitignore

| Path | Size | Reason |
|---|---|---|
| `KoinkatDemo/` | ~83 MB | Old Flask/SQLAlchemy prototype. Has its own nested `.git`, `.venv`, `__pycache__`, plus two oversized backup/temp markdown docs (210 KB + 144 KB). Already in `.gitignore` but still on disk. |
| `47e53ca9-ce28-4daa-82f6-c307ec7f516d.pem` | 3.2 KB | **Private key** at repo root (Enable Banking application key). `.gitignore` covers `*.pem` - verify with `git log --all -- '*.pem'` that it was never committed; if it was, **rotate at Enable Banking immediately**. |
| `957fc6d2-35c5-4f3f-ab60-216c3b3c427f.pem` | 3.2 KB | Second private key, same situation as above. |
| `KoinkatDemo/.env` | - | Contains plaintext Postgres password + two Flask secret keys (`SECRET_KEY`, `WTF_CSRF_SECRET_KEY`). Rotate those secrets on the assumption they are compromised, then delete with the folder. |
| `personal/` (contains `todo.md`) | - | Personal to-do list ("Ask people for feedback", "post it on LinkedIn"). Gitignored. |
| `.playwright-mcp/` | 80 KB | Stale browser captures + console log from a prior Playwright MCP session. Gitignored. |

### Strongly recommend deletion

| Path | Size | Reason |
|---|---|---|
| `.agents/` | 204 KB | Internal planning docs (`tasks/fix-app-wide-bugs.md` 19 KB, `tasks/new-features-plan.md` 44 KB, `docs/architecture.md` etc.). Not gitignored. Likely expose internal process, bug lists, and stale planning you don't want public. |
| `AGENTS.md` | 33 KB | Root-level agent-prompt / internal dev doc. Manual review recommended - often contains team conventions or stale references. |
| `dist/` | 1.6 MB | Vite build output, gitignored. Regenerates on every build. Safe to wipe from disk. |
| `.claude/settings.local.json` | - | Personal Claude Code local settings. Not ignored currently. |
| `.claude/skills/` | - | Personal Claude skills. Not ignored currently. |

### Additional files I think are useless / should be reviewed

| Path | Reason |
|---|---|
| `scripts/generate_mock.py` (37 KB) | Gitignored because of the blanket `scripts/` rule. If it's still needed to regenerate `src/mocks/eb_mock_fixtures.json`, un-ignore just this file. If it's one-shot output, delete. |
| `app-icon.png` (95 KB, repo root) | Looks like the source icon used to generate `src-tauri/icons/*`. Not broken, just loose at the root - consider moving to `src-tauri/icons/source/app-icon.png` or `docs/` for tidiness. Not a must-delete. |
| `docs/callback/` | Flag for review - confirm this is legitimate user-facing docs (likely the Enable Banking OAuth callback page). |

### Manual-review items (flagged for your decision)

- **`.env` files with real credentials** - only one exists (`KoinkatDemo/.env`, listed above). No Vite-facing `.env` files currently exist at the app root.
- Flask secrets in `KoinkatDemo/.env` - rotate then delete.

### `.gitignore` coverage gaps

Current `.gitignore` is good but has gaps worth closing once the cleanup is done:
- `.env.*` does **not** match a bare `.env`. Use `.env*` or both `.env` and `.env.*`.
- `.agents/` is not ignored.
- `.claude/settings.local.json` is not ignored.
- No `*.bak`, `*.old`, `*.backup`, `*.log` patterns.
- No editor/IDE swap patterns (`*.swp`, `*.swo`, `*~`, `.idea/`, `.vscode/`).
- `scripts/` is ignored wholesale, which is too aggressive if `generate_mock.py` is needed by contributors.

---

## 2. Mock & Sandbox Code Inventory

**Terminology note** - the codebase overloads two orthogonal concepts:
- **Mock mode** = build-time `VITE_EB_MOCK` flag. Swaps the real Enable Banking client for fixture-backed stubs. Pure developer harness - not a user-facing feature.
- **Sandbox mode** = runtime workspace type (`connection_type = 'sandbox'`, `is_demo_mode` column). A legitimate user feature - real users can connect to Enable Banking's sandbox environment.

These are independent. The `demo-service.ts` file despite its name belongs to **sandbox mode**, not **mock mode**.

### 2.1 Mock bank API

| File | Purpose | Imported by | Imports |
|---|---|---|---|
| `src/mocks/mock-enable-banking-service.ts` | Fixture-backed stub mirroring the real Enable Banking service (canned banks FinecoBank IT, Nordea DK, Barclays GB; sessions; balances; transactions; split hints). | `src/services/enable-banking-service.ts:23` - the **only** production touchpoint. | `./eb_mock_fixtures.json` |
| `src/mocks/eb_mock_fixtures.json` | Canned sessions / balances / transactions with split-parent/repayment sentinels. | `mock-enable-banking-service.ts` | - |

### 2.2 Sandbox workspace type

**Stays in the production build** - real feature for real users.

Type definitions:
- `src/types/enums.ts:7-8` - `BankEnvironment = 'sandbox' | 'production'`, `ConnectionType = 'manual' | 'sandbox' | 'linked'`.
- `src/types/models.ts:41-42` - `BANK_ENVIRONMENTS`, `CONNECTION_TYPES` readonly arrays.

Schema:
- `src/db/schema-v2.sql:28` - `CHECK (connection_type IN ('manual', 'sandbox', 'linked'))`.
- `src/db/schema-v2.sql:161, 206, 209` - `bank_connections.environment`, `is_demo_mode`.
- `src/db/schema.sql:157, 188, 191` - older schema equivalents.

Services / pages referencing sandbox:
- `src/services/api-config-service.ts:35, 41, 49, 61` - maps `environment === 'sandbox'` to `is_demo_mode` column.
- `src/services/koinkat-account-service.ts:96, 102` - sandbox/linked accounts get empty api_configs row.
- `src/pages/Connection.tsx:53, 166, 173, 197, 221, 255, 310-315, 343-358, 395-399, 630-632` - Sandbox card in the workspace creation UI (**this is the surface to gate in production**).
- `src/pages/Dashboard.tsx:62, 98-150` - `isBankDriven` check + `handleExitSandbox` + sandbox banner.
- `src/pages/Settings.tsx:25, 96, 97, 154` - 'Sandbox' badge.
- `src/stores/bank-store.ts:18, 52, 60` - Zustand store holds `isDemoMode`.

### 2.3 Demo service

| File | Purpose | Importers | Imports |
|---|---|---|---|
| `src/services/demo-service.ts` | Runtime helpers for the sandbox workspace feature: `isSandboxMode()`, `deactivateSandbox()`. **Production code, misleadingly named.** | `src/pages/Dashboard.tsx:30` (single importer, uses `deactivateSandbox`). `isSandboxMode()` currently has no callers. | `../db/database`, `./api-config-service`, `../lib/active-koinkat-account` |

Recommendation: consider renaming to `sandbox-service.ts` to remove the name collision with mock/demo concepts. Low priority.

### 2.4 Mock mode wiring (`VITE_EB_MOCK`)

Every reference across the codebase (docs excluded):

| # | File:Line | Role | What changes when flag is set |
|---|---|---|---|
| 1 | `src/vite-env.d.ts:4` | Type declaration | Declares `ImportMetaEnv.VITE_EB_MOCK?: string`. |
| 2 | `src/services/enable-banking-service.ts:40` | Dispatcher | `const IS_MOCK = import.meta.env.VITE_EB_MOCK === 'true';` Every exported function (`listBanks`, `verifyCredentials`, `startAuthorization`, `createSession`, `getBalances`, `getTransactions`, `getSessionStatus`, `deleteSession`) branches on `IS_MOCK` - delegates to `../mocks/mock-enable-banking-service` (normalizing snake_case to camelCase) or `./enable-banking-service-real`. |
| 3 | `src/pages/BankLink.tsx:60` | Page flag | `IS_MOCK_MODE` constant. |
| 4 | `src/pages/BankLink.tsx:65-69` | Page constant | `MOCK_CODE_MAP` (FinecoBank\|IT to mock-code-eur, etc.). |
| 5 | `src/pages/BankLink.tsx:163-195` (approx) | Flow gate | `handleConnect` skips the real OAuth redirect, synthesizes an `authId`, inserts a `bank_connections` row directly, then calls `handleAuthCallback`. |
| 6 | `src/pages/BankLink.tsx:540-551` | UI | Yellow InfoBanner: "Mock mode active - No real bank connection will be made…" |
| 7 | `src/pages/Review.tsx:27` | Page flag | `IS_MOCK_MODE` constant. |
| 8 | `src/pages/Review.tsx:508-519` | UI | InfoBanner flagging the two fixture split transactions. |

### 2.5 Debug routes

Router config: `src/App.tsx`. One `<Shell />` parent route wraps every nested route.

**All routes defined:**

| Path | Component | In sidebar? |
|---|---|---|
| `/` (index) | `Dashboard` | Yes |
| `/review` | `Review` | Yes |
| `/transactions` | `TransactionList` | Yes |
| `/analysis` | `Analysis` | Yes |
| `/summary` | `Summary` | Yes |
| `/budgets` | `Budgets` | Yes |
| `/categories` | `Categories` | Yes |
| `/settings` | `Settings` | Yes (footer) |
| `/accounts/create`, `/accounts/:id/edit` | `AccountCreate`, `AccountEdit` | No (reached via Dashboard buttons) |
| `/transactions/create`, `/transactions/transfer`, `/transactions/:id/edit`, `/transactions/:id/split` | transaction forms | No (reached via Transactions list) |
| `/bank-link` | `BankLink` | No (reached via Settings/Dashboard) |
| `/budget-events` | redirect to `/budgets` | No (legacy redirect) |
| **`/rules`** | **`Rules`** | **No - explicitly hidden debug route** |

`src/components/layout/Sidebar.tsx:25-28` comment: *"The Rules page is intentionally NOT listed here. It lives at the `/rules` route for internal use (debugging the categorization engine, manual rule edits during development), but we don't want to expose it as a user-facing navigation target."*

The `Rules` page itself is functional (edits user/learned/MCC/system rules) - it's hidden from nav but reachable by typing `/rules` in the URL bar. See Section 6 Q1 for the decision on this.

Note: `src/pages/Connection.tsx` is NOT a route - Shell renders it directly when `view === 'accountHub'`.

### 2.6 Boundary summary (production to mock edges to gate for public build)

| # | From (production code) | To (mock code) | Action for prod build |
|---|---|---|---|
| E1 | `src/services/enable-banking-service.ts:23` `import * as mockService from '../mocks/mock-enable-banking-service'` | `src/mocks/mock-enable-banking-service.ts` | Remove import + dispatcher becomes thin re-export of `-real`. |
| E2 | `src/services/enable-banking-service.ts:40` `const IS_MOCK = ...` + every `if (IS_MOCK) { ... }` branch (lines 45-47, 55-56, 71-79, 94-114, 125-143, 164-202, 212-215, 222-225) | dispatcher branches | Remove. |
| E3 | `src/pages/BankLink.tsx:60` `IS_MOCK_MODE` | env | Remove. |
| E4 | `src/pages/BankLink.tsx:65-69` `MOCK_CODE_MAP` | fixture codes | Remove. |
| E5 | `src/pages/BankLink.tsx:163-195` mock branch in `handleConnect` | direct DB insert + fake callback | Remove entire `if` block. |
| E6 | `src/pages/BankLink.tsx:540-551` mock banner | UI | Remove. |
| E7 | `src/pages/Review.tsx:27` `IS_MOCK_MODE` | env | Remove. |
| E8 | `src/pages/Review.tsx:508-519` mock banner | UI | Remove. |
| E9 | `src/vite-env.d.ts:4` `VITE_EB_MOCK?: string` | typing | Remove (or move to dev-only `.d.ts`). |
| D1 | `src/App.tsx:18, 39` `/rules` route import + Route element | `src/pages/Rules.tsx` | Drop the import + Route tag. |
| S1 | `src/pages/Connection.tsx` Sandbox option in workspace creation (approx lines 310-358) | sandbox UI surface | Hide the Sandbox card/option in production builds. |

Mock code has no production-facing side effects - it only reads from `eb_mock_fixtures.json`, plus BankLink's mock branch writes a `bank_connections` row using the real DB. Removing the mock branch for production is safe.

---

## 3. Package.json Audit

### `dependencies`

| Package | Version | Category | Evidence |
|---|---|---|---|
| `@tauri-apps/api` | `^2` | **Unused (direct)** | 0 imports of `from '@tauri-apps/api'` in `src/`. Transitively satisfied by plugin packages. Safe to drop unless you add a direct `invoke()` call. |
| `@tauri-apps/plugin-deep-link` | `^2.4.8` | Production | `src/pages/BankLink.tsx:287` dynamic `import('@tauri-apps/plugin-deep-link')` |
| `@tauri-apps/plugin-dialog` | `^2` | Production | `src/pages/Connection.tsx:11` (`open as openDialog`) |
| `@tauri-apps/plugin-fs` | `^2` | Production | `src/pages/Connection.tsx:12` (`readTextFile`) |
| `@tauri-apps/plugin-http` | `^2` | Production | `src/lib/fx-fetch.ts:1`, `src/services/enable-banking-service-real.ts:2` |
| `@tauri-apps/plugin-shell` | `^2.3.5` | Production | `src/pages/BankLink.tsx:5` (`open`) |
| `@tauri-apps/plugin-sql` | `^2` | Production | `src/db/database.ts:1` |
| `big.js` | `^6.2.2` | Production | 11 files (money domain + formatters + services) |
| `date-fns` | `^4` | Production | 8 files (Settings, BankLink, services, Budgets, Dashboard) |
| `jose` | `^6.2.2` | Production | `src/services/enable-banking-service-real.ts:1` (JWT signing for EB auth) |
| `lucide-react` | `^0.468` | Production | 22 files (icons) |
| `react` | `^19` | Production | 17+ files |
| `react-dom` | `^19` | Production | `src/main.tsx:2` |
| `react-router` | `^7` | **Unused (direct)** | 0 imports of `from 'react-router'`. `react-router-dom@7` depends on it transitively. Safe to drop as a direct dep. |
| `react-router-dom` | `^7` | Production | 16 files |
| `recharts` | `^2` | Production | `src/pages/Budgets.tsx`, `Dashboard.tsx`, `Summary.tsx` |
| `zustand` | `^5` | Production | 5 store files under `src/stores/` |

### `devDependencies`

| Package | Version | Category | Evidence |
|---|---|---|---|
| `@tailwindcss/vite` | `^4` | Tooling (Vite plugin) | `vite.config.ts:3` |
| `@tauri-apps/cli` | `^2` | Tooling | `npm run tauri` |
| `@types/big.js` | `^6` | Tooling (type-only) | TS types |
| `@types/react` | `^19` | Tooling (type-only) | TS types |
| `@types/react-dom` | `^19` | Tooling (type-only) | TS types |
| `@vitejs/plugin-react` | `^4` | Tooling | `vite.config.ts:2` |
| `tailwindcss` | `^4` | Tooling | Peer of `@tailwindcss/vite`, used via `src/index.css` |
| `typescript` | `^5.7` | Tooling | `tsc` in `build` script |
| `vite` | `^6` | Tooling | `vite dev` / `vite build` |

### Summary

- **Direct-unused (candidates for removal):** `@tauri-apps/api`, `react-router`.
- **No mock-only dependencies.** The mock module uses only `./eb_mock_fixtures.json` - no external packages are attributable exclusively to mock/sandbox code.
- **No test framework installed** (no vitest/jest). If you want CI gates before public release, `vitest` is a natural fit.

---

## 4. Current Build Configuration

### 4.1 `.env*` files

Only one exists in the entire tree:

**`KoinkatDemo/.env`** (10 lines) - variable names only, no values:
`DATABASE_URL`, `APP_ENV`, `LOG_LEVEL`, `SECRET_KEY`, `WTF_CSRF_SECRET_KEY`, `SESSION_LIFETIME_MIN`, `CSRF_TIME_MIN`, `SESSION_COOKIE_SECURE`, `ENABLE_HSTS`.

**No Vite-level `.env` files exist** - `VITE_EB_MOCK` is set from the shell at dev time. There is no `.env.example`, `.env.development`, or `.env.production` for the Tauri app.

### 4.2 `import.meta.env.*` references

Grep across `src/`: **3 runtime reads + 1 type declaration**. All target `VITE_EB_MOCK`.

| File:line | Gating | What it controls |
|---|---|---|
| `src/vite-env.d.ts:4` | Type decl | Declares the env var for TypeScript. |
| `src/services/enable-banking-service.ts:40` | Function dispatch | Every EB export branches mock vs real. |
| `src/pages/BankLink.tsx:60` | Page flow + UI | Mock connect flow + mock-warning banner. |
| `src/pages/Review.tsx:27` | UI | Mock instructions banner. |

### 4.3 `package.json` scripts

| Script | Command | Behavior |
|---|---|---|
| `dev` | `vite` | Vite dev server on port 1420. Used by `tauri dev` via `beforeDevCommand`. |
| `build` | `tsc && vite build` | TS type-check/emit then production bundle into `dist/`. Used by `tauri build`. |
| `preview` | `vite preview` | Serves `dist/` locally for manual QA. |
| `tauri` | `tauri` | Thin passthrough to Tauri CLI. |

No `lint`, `test`, `typecheck`, or `format` scripts.

### 4.4 `vite.config.ts`

30 lines, static config (does not currently accept the `mode` argument).

- **Plugins:** `@vitejs/plugin-react`, `@tailwindcss/vite`.
- **`define`:** none.
- **`build.rollupOptions.output.manualChunks`:** splits `recharts` and `date-fns` into a `vendor-charts` chunk. Bundle-size only.
- **Mode-based conditionals:** none - single static config regardless of `dev` vs `production`.
- **Env-driven behavior:** reads `process.env.TAURI_DEV_HOST` for LAN mobile dev (HMR host).
- Port 1420, `strictPort: true`, watch ignores `src-tauri/**`, `clearScreen: false`.

### 4.5 `src-tauri/tauri.conf.json`

- `productName: "Koinkat"`, `identifier: "com.koinkat.app"`, `version: 0.1.0`.
- `build.frontendDist: "../dist"`, `build.devUrl: "http://localhost:1420"`, `beforeDevCommand: "npm run dev"`, `beforeBuildCommand: "npm run build"`.
- **No conditional / profile settings** - single static config.
- **No `bundle.*` metadata at all** (no icon, targets, publisher, copyright, category, short/long description, signing identity). **Not ready for public distribution as-is.**
- One window: 1280×800, min 900×600, centered.
- Plugins: `sql.preload: ["sqlite:koinkat.db"]`; `deep-link.desktop.schemes: ["koinkat"]`.
- **CSP** (strict baseline):
  - `default-src 'self' tauri:` - good.
  - `script-src 'self' tauri:` - no `unsafe-eval`/`unsafe-inline`. Good.
  - `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com` - inline needed for Tailwind v4; acceptable.
  - `connect-src 'self' https://api.enablebanking.com https://cdn.jsdelivr.net https://latest.currency-api.pages.dev https://*.currency-api.pages.dev ipc: http://ipc.localhost` - three outbound origins. **Audit point:** `cdn.jsdelivr.net` may be unused - see Q10.
  - `frame-ancestors 'none'; object-src 'none'; base-uri 'self'` - all good hardening.

### 4.6 `src-tauri/Cargo.toml`

Thin Rust shell - all real functionality lives in Tauri plugins.

| Crate | Purpose |
|---|---|
| `tauri-build` (build dep) | `build.rs` helper - embeds assets, generates capability files. |
| `tauri` v2 | Core runtime (webview host, IPC, window management). |
| `tauri-plugin-deep-link` | OS-level `koinkat://` URI handler for Enable Banking OAuth callback. |
| `tauri-plugin-sql` (sqlite feature) | Frontend DB access via `@tauri-apps/plugin-sql`. |
| `tauri-plugin-http` | Cross-origin HTTP from webview (FX fetch + EB real client). |
| `tauri-plugin-fs` | Sandboxed filesystem reads (PEM cert via `Connection.tsx`). |
| `tauri-plugin-dialog` | Native file-pick dialogs. |
| `tauri-plugin-shell` | `open()` URL in default browser for OAuth redirect. |
| `serde` (derive) + `serde_json` | IPC (de)serialization for any struct passed over IPC. |
| `tauri-plugin-single-instance` (mac/win/linux, deep-link feature) | Ensures one running instance; forwards `koinkat://` callbacks to the running instance. |

No direct `reqwest`, crypto, or database driver crates - all pushed to plugins or handled in JavaScript.

---

## 5. Proposed Three-Build Structure

### Target matrix

| Script | Vite mode | Mocks available | `/rules` route | Sandbox option in UI | App identifier | Use case |
|---|---|---|---|---|---|---|
| `npm run tauri dev` | `development` | Yes (if `VITE_EB_MOCK=true` in shell) | Visible | Visible | `com.koinkat.app.dev` (suggested) | Daily dev work |
| `npm run tauri build:demo` | `demo` | Yes (forced on by `.env.demo`) | Hidden | Visible | `com.koinkat.app.demo` (suggested) | Tutorial / marketing recordings only |
| `npm run tauri build` | `production` | **Impossible** (build fails if set) | Removed | Hidden | `com.koinkat.app` | Public distribution |

### Implementation

#### A. New env files (commit to repo)

**`.env.development`**
```
VITE_EB_MOCK=false
```

**`.env.demo`**
```
VITE_EB_MOCK=true
```

**`.env.production`**
```
VITE_EB_MOCK=false
```

**`.env.example`** (committed, for contributors)
```
# Set to 'true' in development to use fixture-backed Enable Banking mock client.
# Automatically forbidden in production builds.
VITE_EB_MOCK=false
```

#### B. Updated `package.json` scripts

```json
"scripts": {
  "dev": "vite",
  "build": "tsc && vite build --mode production",
  "build:demo": "tsc && vite build --mode demo",
  "preview": "vite preview",
  "tauri": "tauri",
  "tauri:dev": "tauri dev",
  "tauri:build": "tauri build",
  "tauri:build:demo": "tauri build --config src-tauri/tauri.conf.demo.json",
  "typecheck": "tsc --noEmit",
  "lint": "tsc --noEmit"
}
```

The demo build uses a second Tauri config that overrides `beforeBuildCommand` and the app identifier.

#### C. New `src-tauri/tauri.conf.demo.json`

```json
{
  "$schema": "../node_modules/@tauri-apps/cli/config.schema.json",
  "productName": "Koinkat Demo",
  "identifier": "com.koinkat.app.demo",
  "build": {
    "beforeBuildCommand": "npm run build:demo"
  }
}
```

Tauri v2 merge-patches this over `tauri.conf.json` when passed with `-c`.

#### D. Updated `vite.config.ts`

```ts
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import type { Plugin } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_');
  const mocksAllowed = mode === 'development' || mode === 'demo';
  const debugRoutesAllowed = mode === 'development';
  const sandboxUiAllowed = mode === 'development' || mode === 'demo';

  if (mode === 'production' && env.VITE_EB_MOCK === 'true') {
    throw new Error('Build aborted: VITE_EB_MOCK=true is forbidden in production mode.');
  }

  const host = process.env.TAURI_DEV_HOST;

  return {
    plugins: [
      react(),
      tailwindcss(),
      forbidMocksInProductionBundle(mode),
    ],
    define: {
      '__KOINKAT_ALLOW_MOCKS__': JSON.stringify(mocksAllowed),
      '__KOINKAT_ALLOW_DEBUG_ROUTES__': JSON.stringify(debugRoutesAllowed),
      '__KOINKAT_ALLOW_SANDBOX_UI__': JSON.stringify(sandboxUiAllowed),
    },
    clearScreen: false,
    server: {
      port: 1420,
      strictPort: true,
      host: host || false,
      hmr: host ? { protocol: 'ws', host, port: 1421 } : undefined,
      watch: { ignored: ['**/src-tauri/**'] },
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes('node_modules/recharts') || id.includes('node_modules/date-fns')) {
              return 'vendor-charts';
            }
          },
        },
      },
    },
  };
});

function forbidMocksInProductionBundle(mode: string): Plugin {
  return {
    name: 'koinkat-forbid-mocks-in-production',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      if (mode !== 'production') return;
      for (const [name, chunk] of Object.entries(bundle)) {
        if (chunk.type !== 'chunk') continue;
        const leaked = (chunk.moduleIds ?? []).filter(id => id.includes('/src/mocks/'));
        if (leaked.length > 0) {
          throw new Error(
            `Production bundle leaked mock code in chunk "${name}":\n  ` +
            leaked.join('\n  ')
          );
        }
      }
    },
  };
}
```

#### E. TypeScript globals - add to `src/vite-env.d.ts`

```ts
declare const __KOINKAT_ALLOW_MOCKS__: boolean;
declare const __KOINKAT_ALLOW_DEBUG_ROUTES__: boolean;
declare const __KOINKAT_ALLOW_SANDBOX_UI__: boolean;
```

#### F. Code changes to gate each surface

**`src/services/enable-banking-service.ts`** - guard the mock import so tree-shaking eliminates it in production:

```ts
import * as realService from './enable-banking-service-real';

const IS_MOCK = __KOINKAT_ALLOW_MOCKS__ && import.meta.env.VITE_EB_MOCK === 'true';

// Static import is guarded by the compile-time constant: when
// __KOINKAT_ALLOW_MOCKS__ is replaced with `false` by Vite define,
// the mock import becomes dead code and is eliminated by Rollup.
import * as mockService from '../mocks/mock-enable-banking-service';

export function listBanks(...) {
  if (IS_MOCK) return mockService.listBanks(...);
  return realService.listBanks(...);
}
// ... same pattern for every exported function
```

(In practice, the static import pattern relies on Rollup tree-shaking. If tree-shaking is insufficient, switch to a dynamic `await import('../mocks/...')` behind the `IS_MOCK` gate - the post-bundle scan catches any leak regardless.)

**`src/pages/BankLink.tsx`**:
- `const IS_MOCK_MODE = __KOINKAT_ALLOW_MOCKS__ && import.meta.env.VITE_EB_MOCK === 'true'`
- Wrap `MOCK_CODE_MAP` + mock branch of `handleConnect` in `if (__KOINKAT_ALLOW_MOCKS__ && IS_MOCK_MODE)`.
- Wrap InfoBanner in `{__KOINKAT_ALLOW_MOCKS__ && IS_MOCK_MODE && <InfoBanner ... />}`.

**`src/pages/Review.tsx`**: same pattern for the mock InfoBanner.

**`src/App.tsx`**:
```tsx
{__KOINKAT_ALLOW_DEBUG_ROUTES__ && (
  <Route path="rules" element={<Rules />} />
)}
```
Make the `Rules` import lazy: `const Rules = __KOINKAT_ALLOW_DEBUG_ROUTES__ ? lazy(() => import('./pages/Rules')) : null;`

**`src/pages/Connection.tsx`**:
- Wrap the Sandbox workspace-creation card in `{__KOINKAT_ALLOW_SANDBOX_UI__ && <SandboxCard />}`.
- Filter `ConnectionType` options list to exclude `'sandbox'` when `!__KOINKAT_ALLOW_SANDBOX_UI__`.
- Leave all sandbox runtime handling code intact (existing sandbox workspaces must continue to work). Only the "create new sandbox workspace" option is hidden.

### Why mocks cannot reach users in production - three layers of defense

1. **Compile-time flag replacement.** `__KOINKAT_ALLOW_MOCKS__` is replaced with the literal `false`. Rollup dead-code elimination removes every guarded branch and drops the now-unreferenced mock import.
2. **Build-time assertion.** `vite.config.ts` throws immediately if `VITE_EB_MOCK=true` is set when mode is `production`.
3. **Post-bundle scan.** The `forbidMocksInProductionBundle` plugin inspects every emitted chunk's `moduleIds` and fails the build if `/src/mocks/` appears anywhere - defense-in-depth for future contributors who might add new mock imports without a flag.

---

## 6. Risks & Open Questions

**Q1. `/rules` - fully remove from production or keep as a hidden admin tool?**
The Sidebar comment frames it as internal-only. But the Rules page IS functional (edits user/learned/MCC/system rules). If power users should be able to tweak categorization, consider surfacing it inside Settings rather than via a bare URL. If it's dev-only, remove in production as proposed.
**Proposed default:** fully removed in production, reachable in dev + demo.

**Q2. Sandbox workspace type - hide UI only, or also migrate schema?**
The proposal hides the Sandbox creation card in production. The DB schema keeps `'sandbox'` as valid, and existing sandbox workspaces keep working. Removing from the schema is a breaking migration - not recommended before v1.0.
**Proposed default:** hide UI only, schema intact.

**Q3. Demo build - separate app identifier or same as production?**
Separate (`com.koinkat.app.demo`) allows demo and production to coexist on the same machine. Same identifier means demo overwrites production. For tutorial recording, coexistence is safer.
**Proposed default:** separate identifier.

**Q4. Demo build - keep mock warning banners visible?**
The yellow InfoBanners in BankLink and Review confirm mock mode is active. For tutorial recordings they may be distracting. Options: (a) keep in demo - honest; (b) hide in demo, keep in dev only.
**Proposed default:** keep banners in demo.

**Q5. `.agents/`, `AGENTS.md`, `scripts/generate_mock.py` - delete or extract?**
For a solo project seeking feedback, these planning docs signal "unfinished". For an open-source project, architecture docs help contributors. The generation script could be legitimately useful if the mock fixtures need regenerating.
**Proposed default:** move useful architecture content into `docs/`; delete the rest.

**Q6. Remove unused direct deps `@tauri-apps/api` and `react-router`?**
Both confirmed unused. One-line `npm uninstall`. Low risk.
**Proposed default:** remove in the restructure.

**Q7. Bundle metadata for `tauri.conf.json` - in scope for this restructure?**
Production builds currently produce an unsigned, undescribed binary. This is a distribution blocker (no icon, no publisher, no signing) but separable from the mock/sandbox isolation work.
**Proposed default:** separate follow-up task.

**Q8. Were `KoinkatDemo/.env` and the `.pem` files ever committed?**
Run: `git log --all -- 'KoinkatDemo/.env' '47e53ca9*.pem' '957fc6d2*.pem'`
If any appear in git history, rotate the Enable Banking keys and Flask secrets, then decide between rewriting history or initializing a fresh repo (preferred for a brand-new public release - push a clean initial commit with no history).
**Action required before going public.**

**Q9. Deep-link scheme collision between demo and production builds.**
Both share `koinkat://` in `tauri.conf.json`. With separate identifiers the OS registers two handlers. If both are installed simultaneously the wrong instance may receive the OAuth callback. Worth testing during demo build validation.
**Proposed default:** note and test; likely fine in practice.

**Q10. CSP `connect-src` includes `https://cdn.jsdelivr.net` - is it used?**
No obvious call site was found. If unused, remove it from the CSP to reduce the allowed outbound surface.
**Action:** `grep -r 'jsdelivr' src/` - if zero results, remove from `tauri.conf.json`.

---

## Execution outcome (2026-04-24)

The restructure shipped. Deviations from the audit's proposal, all intentional:

1. **No `.env*` files exist.** The audit proposed four committed env files (`.env.development`, `.env.demo`, `.env.production`, `.env.example`) holding `VITE_EB_MOCK`. Instead, all `.env*` are gitignored and mock enablement is hardcoded in `vite.config.ts` via a new compile-time flag `__KOINKAT_EB_MOCK_DEFAULT__`. The runtime `VITE_EB_MOCK` env var is gone.
2. **Production mock defense is three layers, not two.** `__KOINKAT_ALLOW_MOCKS__` dead-codes mock branches; the compile-time replacement of `__KOINKAT_EB_MOCK_DEFAULT__` means `IS_MOCK` collapses to `false` in production; and `forbidMocksInProductionBundle` in `vite.config.ts` scans every chunk's `moduleIds` post-bundle and aborts if any `/src/mocks/` leaks through.
3. **Dev + demo both default mocks ON.** Contributors never need live Enable Banking credentials to run the app. Flip `mocksOnByDefault` in `vite.config.ts` to test the real client.
4. **`KoinkatDemo/`, the `.pem` files, `personal/`, and `.playwright-mcp/` were moved to `junk/` (gitignored) rather than deleted outright.** Nothing was ever committed to git history (verified via `git log --all --`). `junk/` is git-ignored, so public publishing is safe.
5. **`.claude/`, `.agents/`, and `AGENTS.md` are gitignored but kept on disk** for internal tooling. Per user preference.
6. **`app-icon.png` moved to `src-tauri/icons/source/app-icon.png`** rather than deleted - it's the source asset for the Tauri icon pipeline.
7. **`@tauri-apps/api` and `react-router` removed** from direct deps (unused). All bank/tauri plugins still satisfy their transitive needs.

Build verification on 2026-04-24: `npm run build` → 617 KB, `npm run build:demo` → 658 KB, `tsc --noEmit` clean. The 41 KB delta between builds is exactly the tree-shaken mock code.

Still open from the original audit:
- Q7 (tauri.conf.json bundle metadata - signing identity, icons, publisher, category) - blocker before public distribution.
- Q10 (prune `cdn.jsdelivr.net` from CSP) - **resolved as a non-issue, see Follow-up audit (2026-04-28) below.**

---

## Follow-up audit (2026-04-28)

A second read of the codebase after the restructure landed. Verifies what
the postscript above claimed and corrects one item.

### Q10 - CSP `cdn.jsdelivr.net` entry - KEEP

The original audit recommended pruning `https://cdn.jsdelivr.net` from the
CSP `connect-src` because no call site was found. That was wrong:
`src/lib/fx-fetch.ts:21-23` uses
`https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@…/v1/currencies/usd.json`
as the **primary** exchange-rate URL (with `*.currency-api.pages.dev` as
the fallback). Both hosts must remain in the CSP.

**Action:** none - leave the CSP entry alone.

### Confirmed in current state (2026-04-28)

- The four compile-time flags (`__KOINKAT_ALLOW_MOCKS__`,
  `__KOINKAT_EB_MOCK_DEFAULT__`, `__KOINKAT_ALLOW_DEBUG_ROUTES__`,
  `__KOINKAT_ALLOW_SANDBOX_UI__`) are wired exactly where the postscript
  said they would be (`vite.config.ts`, `src/vite-env.d.ts`,
  `enable-banking-service.ts:46`, `BankLink.tsx`, `Review.tsx`,
  `App.tsx:41-43`, `Connection.tsx`).
- `package.json` scripts match: `dev`, `build` (mode=production),
  `build:demo` (mode=demo), `preview`, `tauri`, `tauri:dev`, `tauri:build`,
  `tauri:build:demo`, `typecheck`. Direct deps `@tauri-apps/api` and
  `react-router` are gone.
- `src-tauri/tauri.conf.demo.json` exists and overrides only
  `productName`, `identifier`, and `beforeBuildCommand`.
- `forbidMocksInProductionBundle` post-bundle plugin is in place at the
  bottom of `vite.config.ts`.
- `.gitignore` covers `.env`, `.env.*`, `*.pem`, `*.key`, `*.p8`,
  `*.p12`, `*.pfx`, `*.crt`, `*.cer`, `*.cert`, `*.der`, `*.asc`,
  `*.gpg`, `*.jks`, `*.keystore`, `*.mobileprovision`, common SSH key
  filenames, `credentials.json`, `secrets.json`, `service-account*.json`,
  `.npmrc`, `.netrc`, `auth.json`, `secrets/`, `.secrets/`, `.tauri/`,
  `junk/`, `KoinkatDemo/`, `.playwright-mcp/`, `personal/`, `scripts/`,
  `.agents/`, `.claude/`, `AGENTS.md`.
- `junk/` is the on-disk archive - never tracked, never referenced from
  source.

### Still open

| # | What | Urgency |
|---|------|---------|
| Q7 | `src-tauri/tauri.conf.json` `bundle.*` metadata. **Mostly resolved 2026-05-16** - icons (32 / 128 / 128@2x / .icns / .ico), `category: Finance`, short/long descriptions added (commit `1142713`); `copyright`, `publisher`, `homepage` filled (same-day follow-up to Marco Sburlino / `MarcoSburlino/Koinkat`). Still pending: no code-signing identity / notarization profile. | High - distribution blocker |
| - | No `README.md` at the repo root. **Resolved 2026-05-16** - minimal `README.md` added. | - |
| - | No `LICENSE` file. Deferred per maintainer choice until publication strategy decided. | Medium |
| - | No automated tests. **Partially resolved 2026-05-16** - `vitest@4.1.5` installed; `src/domain/money.test.ts` ships 42 tests (commit `1efb080`). Service / migration / UI tests not started. | Medium |
| - | `demo-service.ts` is misleadingly named - it is the **sandbox** workspace runtime, not anything to do with mocks or the demo build. Low-priority rename to `sandbox-service.ts`. | Low |
| - | `src/db/schema.sql` (legacy v1) is still on disk alongside `schema-v2.sql`. Kept for reference only - confirm nothing in the migration runner reads it. | Low |
| - | `src/components/ErrorBoundary.tsx` GitHub-issues link. **Resolved 2026-05-16** - points at `https://github.com/MarcoSburlino/Koinkat/issues/new`. | - |
| - | `src/lib/fx-fetch.ts` primary URL `cdn.jsdelivr.net` vs CSP. **Resolved 2026-05-16** - `cdn.jsdelivr.net` restored to `connect-src` (the "tightening" in `1142713` over-shot; the maintainer chose to keep jsDelivr as primary). | - |
