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
// Deliberately kept in localStorage, and deliberately NEVER cleared by logout,
// by leaving a workspace, or by deleting a user. The whole point is to be an
// INDEPENDENT witness to the database, so storing it in the database would
// defeat the purpose.

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

export function isDeviceProvisioned(): boolean {
  try {
    if (localStorage.getItem(KEY) === '1') return true;
    return LEGACY_EVIDENCE.some((k) => localStorage.getItem(k) !== null);
  } catch {
    return false;
  }
}
