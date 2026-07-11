## What does this PR do?

<!-- One or two sentences. Link the issue it closes, if any. -->

## Checklist

- [ ] `npm run typecheck` passes
- [ ] `npm run test` passes
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml` passes (if `src-tauri/` changed)
- [ ] Money amounts go through `src/domain/money.ts` (no float arithmetic)
- [ ] New workspace-scoped queries call `requireActiveKoinkatAccountId()`
- [ ] New monetary DOM nodes carry `data-privacy-field`
- [ ] No new imports of `src/mocks/` outside the dispatcher
- [ ] No edits to `src/db/schema*.sql` or applied migrations (add a new `migration-vN.sql` instead)
- [ ] Docs in `docs/` updated if behavior changed
- [ ] No em dashes in copy, comments, or docs (use "-" or "·")
