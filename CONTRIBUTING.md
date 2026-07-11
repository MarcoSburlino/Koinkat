# Contributing to Koinkat

Thanks for your interest. Koinkat is a local-first personal finance
manager; correctness around money and privacy is the project's whole
reason to exist, so the bar for those areas is deliberately high.

## Getting set up

Prerequisites: Node 20+ and a stable Rust toolchain, plus the
[Tauri 2 prerequisites](https://v2.tauri.app/start/prerequisites/) for
your OS (on Linux also `libdbus-1-dev` for the keychain backend).

```bash
git clone https://github.com/MarcoSburlino/Koinkat.git
cd Koinkat
npm install
npm run tauri:dev    # dev window; the bank API is mocked, no credentials needed
```

Useful commands:

| Command | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` - run after every change |
| `npm run test` | vitest unit tests |
| `npm run build` | production web bundle + the mock-leak scanner |
| `cargo check --manifest-path src-tauri/Cargo.toml` | Rust shell check |
| `npm run tauri:build` | full production binary |
| `npm run tauri:build:demo` | demo binary (installs side by side) |

See [`docs/development.md`](docs/development.md) for the three build
modes and [`docs/architecture.md`](docs/architecture.md) for how the
codebase is layered.

## The invariants (PRs that break these will be declined)

1. **Money math goes through `src/domain/money.ts`** (`dec`, `qCent`,
   `qRate`, `convertAmount`, `tryConvert`). Never `parseFloat`, never raw
   `number` arithmetic on amounts. Amounts are decimal strings end to end;
   `.toNumber()` only at a terminal display boundary (chart geometry).
2. **Every workspace-scoped query filters by `koinkat_account_id`.** Call
   `requireActiveKoinkatAccountId()` at the top of any service function
   touching workspace data. Missing this is a cross-workspace data leak.
3. **`src/mocks/` is importable only from the dispatcher**
   (`src/services/enable-banking-service.ts`). The production build fails
   if a mock module leaks into any chunk.
4. **Never edit `src/db/schema*.sql` or an applied migration.** Their
   hashes are checked at boot; editing them bricks existing installs. Add
   a new `src/db/migration-vN.sql` and register it in
   `src-tauri/src/lib.rs`.
5. **Every monetary DOM node carries `data-privacy-field`** so privacy
   mode can blur it.
6. **Aggregations exclude repayments and use net amounts for split
   parents** - reuse the SQL fragments in `src/domain/tx-sql.ts`.
7. **Rust stays thin.** Business logic is TypeScript; `src-tauri/` hosts
   the webview, plugins, migrations, and the keychain commands - nothing
   else without prior discussion.
8. **No em dashes** in copy, comments, or docs. Use "-" or the "·"
   separator.

## Pull requests

- Keep PRs focused; unrelated refactors go in their own PR.
- CI must be green (typecheck, tests, production bundle, cargo check on
  all three OSes).
- If behavior changes, update the matching doc in `docs/` in the same PR.
- Never include real bank data, credentials, or `.pem` files in code,
  fixtures, tests, or issue text.

## Reporting bugs and vulnerabilities

- Bugs: use the issue template. Sanitize any pasted error text.
- Security vulnerabilities: **privately**, per [SECURITY.md](SECURITY.md).

## Release process (maintainer)

1. Bump the version in `package.json`, `src-tauri/Cargo.toml`, and
   `src-tauri/tauri.conf.json` (CI fails on mismatch).
2. Move the `Unreleased` section of `CHANGELOG.md` under the new version.
3. Tag and push: `git tag vX.Y.Z && git push origin vX.Y.Z`. The release
   workflow builds installers for Windows/macOS/Linux and attaches them to
   a draft GitHub release.
4. Review the draft, edit notes, publish.
