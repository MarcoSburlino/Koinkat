// What the boot-error screen is reporting. The principle behind all three: if
// the user has data, the app must find it - and when it cannot open it, it
// must say why without ever implying the data is gone or inviting a fresh
// start on top of it.
//
//   readFailed   - opening or reading the database threw for a reason that
//                  says nothing about what is on disk. Retry.
//   newerVersion - the database holds a migration this build has never heard
//                  of: a newer Koinkat opened it and upgraded it. The data is
//                  intact, and retrying can never help - only installing the
//                  newer version can. Before this existed the screen said the
//                  problem "usually clears up on a retry", which it never
//                  does. Old download links make this realistic: until
//                  2026-09-19 the README pinned installer links to v0.1.2.
//   noUsers      - the database opened and answered, but with zero users on
//                  a device that has been set up before.
//   orphanedData - zero users, yet the database still holds workspaces
//                  (koinkat_accounts.user_id has no foreign key, so a lost
//                  user row strands them). The data is right there, so the
//                  only way forward offered is to recover it - never a fresh
//                  start, which would hide it behind a new empty user.
export type BootErrorKind = 'readFailed' | 'newerVersion' | 'noUsers' | 'orphanedData';

// sqlx's wording for an applied migration missing from this build's list
// (`MigrateError::VersionMissing`, sqlx-core 0.8 `migrate/error.rs`), which
// tauri-plugin-sql passes through verbatim (`#[error(transparent)]`).
const NEWER_VERSION =
  /migration (\d+) was previously applied but is missing in the resolved migrations/;

/** Classify a thrown boot failure. The empty-read kinds are never throws. */
export function classifyBootFailure(
  message: string,
): Exclude<BootErrorKind, 'noUsers' | 'orphanedData'> {
  return NEWER_VERSION.test(message) ? 'newerVersion' : 'readFailed';
}
