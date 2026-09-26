// "Has this device ever completed Koinkat setup?" - a one-way breadcrumb.
//
// It exists to tell two very different situations apart:
//   * no users AND no breadcrumb -> a genuinely new install, offer registration
//   * no users BUT a breadcrumb  -> a device that HAS been set up read back
//                                   zero users, so something failed; show the
//                                   boot-error screen instead
//
// Before this existed both rendered the first-run "create a user" form, so a
// transient database failure was indistinguishable from a fresh install - and
// registering there would have orphaned the real workspace behind a second
// user row.
//
// Deliberately kept in localStorage, and deliberately NEVER cleared by logout
// or by leaving a workspace. The whole point is to be an INDEPENDENT witness
// to the database, so storing it in the database would defeat the purpose.
//
// It IS cleared by the two deliberate resets, because a breadcrumb that
// outlives a reset the user asked for is a trap, not a safeguard: nothing
// could ever reach registration again, and the boot-error screen would insist
// "nothing has been deleted" about data the user removed on purpose.
//   * deleting the last user (typed-name confirmation on the user picker)
//   * "Start fresh" on the boot-error screen (typed confirmation), which is
//     the way out after deleting the data folder by hand. That folder holds
//     the database; this breadcrumb lives in the webview's own profile
//     folder, so deleting one leaves the other behind.
// Both reach registration, which only ever ADDS a user row - no path through
// either reset deletes anything.

const KEY = 'koinkat_device_provisioned';

// Installs from before migration v12 never wrote KEY, but they did write these
// pointers. Treat either as proof the device was set up, so an existing user
// upgrading to this version is protected on their very first boot afterwards.
const LEGACY_EVIDENCE = [
  'koinkat_active_user_id',
  'koinkat_active_koinkat_account_id',
];

export function markDeviceProvisioned(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * Forget that this device was ever set up. Only for the two deliberate resets
 * described at the top of this file, and only when the database has just
 * been read back with zero users - otherwise the next boot would offer
 * registration on top of data that still exists.
 *
 * Removes the legacy pointers as well: `isDeviceProvisioned()` treats either
 * one as proof of setup, so leaving them would keep the tripwire armed. With
 * no users they point at nothing.
 */
export function clearDeviceProvisioned(): void {
  for (const k of [KEY, ...LEGACY_EVIDENCE]) {
    try {
      localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  }
}

export function isDeviceProvisioned(): boolean {
  try {
    if (localStorage.getItem(KEY) === '1') return true;
    return LEGACY_EVIDENCE.some((k) => localStorage.getItem(k) !== null);
  } catch {
    return false;
  }
}
