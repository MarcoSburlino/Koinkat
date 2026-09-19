import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { useAppStore } from '../../stores/app-store';
import { useUiStore } from '../../stores/ui-store';
import { useBankStore, FX_UNAVAILABLE_MSG } from '../../stores/bank-store';
import { useUserStore } from '../../stores/user-store';
import { useKoinkatAccountStore } from '../../stores/koinkat-account-store';
import { ensureTodayRates } from '../../services/exchange-rate-service';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import markGreen from '../../assets/koinkat-mark-green.png';
import markWhite from '../../assets/koinkat-mark-white.png';
import { UserRegister } from '../../pages/UserRegister';
import { UserLogin } from '../../pages/UserLogin';
import { Connection } from '../../pages/Connection';
import { BootError } from './BootError';
import {
  isDeviceProvisioned,
  markDeviceProvisioned,
} from '../../lib/device-provisioned';

function applyTheme(theme: string) {
  const html = document.documentElement;
  html.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
}

type View =
  | 'userRegister'
  | 'userLogin'
  | 'accountHub'
  | 'app'
  | 'bootError';

export function Shell() {
  const setSettings = useAppStore((s) => s.setSettings);
  const markInitialized = useAppStore((s) => s.markInitialized);
  const initialized = useAppStore((s) => s.initialized);
  const theme = useAppStore((s) => s.settings.theme);

  const sidebarOpen = useUiStore((s) => s.sidebarOpen);
  const privacyMode = useUiStore((s) => s.privacyMode);

  const bankLoadConfig = useBankStore((s) => s.loadConfig);
  const bankLoadConnections = useBankStore((s) => s.loadConnections);

  const users = useUserStore((s) => s.users);
  const activeUser = useUserStore((s) => s.activeUser);
  const loadUsers = useUserStore((s) => s.loadUsers);
  const loadActiveUser = useUserStore((s) => s.loadActiveUser);

  const activeKoinkatAccount = useKoinkatAccountStore((s) => s.activeKoinkatAccount);
  const loadAccounts = useKoinkatAccountStore((s) => s.loadAccounts);
  const loadActiveKoinkatAccount = useKoinkatAccountStore(
    (s) => s.loadActiveKoinkatAccount,
  );
  const resetKoinkatAccountStore = useKoinkatAccountStore((s) => s.reset);

  const [view, setView] = useState<View>('app');
  // Surfaces a `bootstrap()` failure to the user. Without this, a thrown
  // `loadUsers` / `loadActiveUser` / etc. would silently log to
  // console.error while `view` stayed at the initial 'app' default and
  // the Header (gated on `activeUser`) hid every escape hatch.
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);

  // Apply theme whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * Bootstrap resolves the four-state hierarchy:
   *   no users, never set up → userRegister
   *   no users, BUT set up before → bootError (the read is lying)
   *   users, no active user  → userLogin
   *   active user, no active koinkat account → accountHub
   *   active user + active koinkat account   → app
   *   anything threw         → bootError
   */
  const bootstrap = useCallback(async () => {
    try {
      setBootstrapError(null);
      await loadUsers();

      const usersAfterLoad = useUserStore.getState().users;

      // TRIPWIRE. An empty `users` table means one of two very different
      // things, and they must not render the same screen:
      //   * this device has never been set up  -> genuinely new, register
      //   * this device HAS been set up before -> the read is lying to us
      // The second case used to fall through to the first-run form, which
      // invited the user to create a second user row that would have orphaned
      // their real workspace. Refuse, and show the recoverable error instead.
      if (usersAfterLoad.length === 0) {
        if (isDeviceProvisioned()) {
          resetKoinkatAccountStore();
          setBootstrapError(
            'The database opened but reported no users, even though this ' +
              'device has been set up before. Your data has not been deleted.',
          );
          setView('bootError');
          return;
        }
        resetKoinkatAccountStore();
        setView('userRegister');
        return;
      }

      // At least one real user exists - arm the tripwire for future boots.
      markDeviceProvisioned();

      // Cold start: allow the single-user / single-workspace self-heal, so a
      // lost pointer does not strand the user at a picker with one option.
      await loadActiveUser({ autoSelectSingle: true });

      const freshUsers = useUserStore.getState().users;
      const freshActiveUser = useUserStore.getState().activeUser;

      if (freshUsers.length === 0) {
        resetKoinkatAccountStore();
        setView('userRegister');
        return;
      }

      if (!freshActiveUser) {
        resetKoinkatAccountStore();
        setView('userLogin');
        return;
      }

      // User is logged in - load their koinkat accounts.
      await loadAccounts(freshActiveUser.id);
      await loadActiveKoinkatAccount({ autoSelectSingle: true });
      const freshActiveAccount =
        useKoinkatAccountStore.getState().activeKoinkatAccount;

      if (!freshActiveAccount) {
        setView('accountHub');
        return;
      }

      // Have both. Seed app-store settings from the active koinkat account.
      setSettings({
        preferredCurrency: freshActiveAccount.preferredCurrency,
        decimalSeparator: freshActiveAccount.decimalSeparator,
        theme: freshActiveAccount.theme,
      });
      applyTheme(freshActiveAccount.theme);

      // FX and bank initialisation deliberately does NOT happen here. The
      // workspace effect below owns it, and that effect fires as soon as
      // bootstrap completes (both `activeKoinkatAccount` and `initialized`
      // change during bootstrap) as well as on every later workspace
      // switch. Running it in both places meant a cold start fired
      // loadConfig/loadConnections/startSync twice, with the duplicate
      // masked rather than prevented by the `isSyncing` guard in bank-store.

      setView('app');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Init failed:', err);
      setBootstrapError(msg);
      // ALWAYS the dedicated error view. This used to guess between
      // 'userLogin' and 'userRegister' based on `users`, which is still the
      // initial [] whenever `loadUsers()` is what threw - so a transient
      // database lock after a Windows restart rendered the first-run "create
      // a user" form on top of a perfectly intact database. A failed read and
      // an empty read are not the same thing; never let them share a screen.
      resetKoinkatAccountStore();
      setView('bootError');
    } finally {
      markInitialized();
    }
  }, [
    loadUsers,
    loadActiveUser,
    loadAccounts,
    loadActiveKoinkatAccount,
    resetKoinkatAccountStore,
    setSettings,
    bankLoadConfig,
    bankLoadConnections,
    markInitialized,
  ]);

  useEffect(() => {
    bootstrap();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * React to user changes (login, logout, create, delete):
   * Resolve from active user all the way down to the correct view.
   */
  useEffect(() => {
    if (!initialized) return;
    // Never navigate away from the boot-error screen. bootstrap() sets it and
    // marks the app initialized in the same batch, so without this guard this
    // effect would immediately fire with a null activeUser and replace it with
    // the very registration form the error screen exists to prevent.
    if (view === 'bootError') return;
    let cancelled = false;
    (async () => {
      if (!activeUser) {
        resetKoinkatAccountStore();
        if (cancelled) return;
        // Same tripwire as bootstrap(): zero users on a device that has been
        // set up before is a failure, not a fresh install.
        if (users.length === 0 && isDeviceProvisioned()) {
          setBootstrapError(
            'The database reported no users, even though this device has ' +
              'been set up before. Your data has not been deleted.',
          );
          setView('bootError');
          return;
        }
        setView(users.length > 0 ? 'userLogin' : 'userRegister');
        return;
      }
      // User logged in → load their koinkat accounts and decide between
      // the hub and the app based on the active koinkat account.
      try {
        await loadAccounts(activeUser.id);
        await loadActiveKoinkatAccount();
      } catch (err) {
        // Previously an unhandled rejection: the view stayed on whatever it
        // was and the failure only reached the console.
        if (cancelled) return;
        console.error('Workspace resolution failed:', err);
        setBootstrapError(err instanceof Error ? err.message : String(err));
        setView('bootError');
        return;
      }
      if (cancelled) return;
      const ka = useKoinkatAccountStore.getState().activeKoinkatAccount;
      setView(ka ? 'app' : 'accountHub');
    })();
    return () => {
      cancelled = true;
    };
    // `initialized` is included so this effect re-fires once bootstrap
    // finishes - otherwise the initial-mount run sees !initialized,
    // returns early, and the fallback routing never runs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeUser?.id, initialized]);

  /**
   * React to koinkat-account changes (enter/leave/create/delete):
   * Switch between the hub and the app, and refresh bank state when
   * entering a new workspace.
   */
  useEffect(() => {
    if (!initialized) return;
    if (view === 'bootError') return; // never navigate away from the error
    if (!activeUser) return; // handled by the user effect above

    if (!activeKoinkatAccount) {
      setView('accountHub');
      return;
    }

    // Entering a koinkat account - re-apply settings + reload bank state.
    setSettings({
      preferredCurrency: activeKoinkatAccount.preferredCurrency,
      decimalSeparator: activeKoinkatAccount.decimalSeparator,
      theme: activeKoinkatAccount.theme,
    });
    applyTheme(activeKoinkatAccount.theme);
    // Config and connections MUST resolve before startSync: runFxSync guards
    // on `isConfigured`, which still holds the PREVIOUS workspace's value
    // until loadConfig lands - firing the sync first silently skips it (or
    // runs it against stale config) after a workspace switch.
    // Non-fatal: the user and workspace are already resolved, so the app is
    // usable regardless. FX needs the network - routinely still down in the
    // seconds after a laptop restart, exactly when this first runs - and
    // bank config/connections have their own in-app error surfaces.
    void (async () => {
      try {
        const fxOk = await ensureTodayRates();
        useBankStore.getState().setFxError(fxOk ? null : FX_UNAVAILABLE_MSG);
        await bankLoadConfig();
        await bankLoadConnections();
        // Through the store, so failures populate `lastSyncError` and reach
        // the UI banner instead of being lost to console.warn.
        await useBankStore.getState().startSync();
      } catch (err) {
        console.warn('Workspace bank init failed:', err);
        useBankStore.getState().setFxError(FX_UNAVAILABLE_MSG);
      }
    })();
    setView('app');
    // `initialized` keeps this effect in sync with bootstrap completion
    // - same rationale as the activeUser effect above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeKoinkatAccount?.id, initialized]);

  const handleRegistered = useCallback(async () => {
    // User was created and marked active by UserRegister.
    await loadActiveUser();
    const user = useUserStore.getState().activeUser;
    if (user) {
      await loadAccounts(user.id);
    }
    // New users always land on the account hub to set up their first workspace.
    setView('accountHub');
  }, [loadActiveUser, loadAccounts]);

  const handleUserSelected = useCallback(async () => {
    const user = useUserStore.getState().activeUser;
    if (!user) {
      setView('userLogin');
      return;
    }
    await loadAccounts(user.id);
    await loadActiveKoinkatAccount();
    const ka = useKoinkatAccountStore.getState().activeKoinkatAccount;
    setView(ka ? 'app' : 'accountHub');
  }, [loadAccounts, loadActiveKoinkatAccount]);

  const handleCreateNewUser = useCallback(() => {
    setView('userRegister');
  }, []);

  // Re-runs the whole bootstrap in place. This only works because getDb() no
  // longer caches a rejected promise - before that fix, every retry replayed
  // the original failure and the only way out was restarting the app.
  const handleRetry = useCallback(async () => {
    setRetrying(true);
    try {
      await bootstrap();
    } finally {
      setRetrying(false);
    }
  }, [bootstrap]);

  const handleCancelRegister = useCallback(() => {
    if (users.length > 0) setView('userLogin');
  }, [users.length]);

  if (!initialized) {
    return (
      <div
        className="flex flex-col items-center justify-center min-h-screen gap-4"
        style={{ backgroundColor: 'var(--bg)' }}
      >
        <img
          src={theme === 'dark' ? markWhite : markGreen}
          alt="Koinkat"
          className="h-12 w-auto opacity-80"
        />
        <p className="text-sm" style={{ color: 'var(--text-muted)' }}>
          Loading…
        </p>
      </div>
    );
  }

  // The boot-error screen stands alone: no Header, no sidebar, and crucially
  // no route into registration. Rendering it before the normal shell means
  // there is no chrome through which the user can reach a "create user" form
  // while the app cannot read the database.
  if (view === 'bootError') {
    return (
      <BootError
        message={bootstrapError ?? 'Unknown error while opening the database.'}
        onRetry={() => {
          void handleRetry();
        }}
        retrying={retrying}
      />
    );
  }

  return (
    <div
      className={`min-h-screen ${privacyMode ? 'privacy-mode' : ''}`}
      style={{ backgroundColor: 'var(--bg)' }}
    >
      <Header
        view={view}
        showProfileControls={view === 'app' || view === 'accountHub'}
        showSidebarToggle={view === 'app'}
      />
      {view === 'userRegister' && (
        <UserRegister
          onComplete={handleRegistered}
          onCancel={users.length > 0 ? handleCancelRegister : undefined}
        />
      )}
      {view === 'userLogin' && (
        <UserLogin onSelect={handleUserSelected} onCreateNew={handleCreateNewUser} />
      )}
      {view === 'accountHub' && <Connection />}
      {view === 'app' && (
        <div className="flex">
          {sidebarOpen && <Sidebar />}
          <main className="flex-1 min-w-0 p-6">
            <div className="mx-auto w-full" style={{ maxWidth: 'var(--content-max)' }}>
              <Outlet />
            </div>
          </main>
        </div>
      )}
    </div>
  );
}
