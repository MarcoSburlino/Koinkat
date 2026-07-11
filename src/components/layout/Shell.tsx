import { useEffect, useState, useCallback } from 'react';
import { Outlet } from 'react-router-dom';
import { AlertCircle } from 'lucide-react';
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

function applyTheme(theme: string) {
  const html = document.documentElement;
  html.setAttribute('data-theme', theme);
  if (theme === 'dark') {
    html.classList.add('dark');
  } else {
    html.classList.remove('dark');
  }
}

type View = 'userRegister' | 'userLogin' | 'accountHub' | 'app';

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

  // Apply theme whenever it changes
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /**
   * Bootstrap resolves the four-state hierarchy:
   *   no users               → userRegister
   *   users, no active user  → userLogin
   *   active user, no active koinkat account → accountHub
   *   active user + active koinkat account   → app
   */
  const bootstrap = useCallback(async () => {
    try {
      await loadUsers();
      await loadActiveUser();

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
      await loadActiveKoinkatAccount();
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
      const fxOk = await ensureTodayRates();
      useBankStore.getState().setFxError(fxOk ? null : FX_UNAVAILABLE_MSG);
      await bankLoadConfig();
      await bankLoadConnections();
      // Route through the store so failures populate `lastSyncError` and
      // surface in the UI banner, instead of being lost to console.warn.
      void useBankStore.getState().startSync();
      setView('app');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error('Init failed:', err);
      setBootstrapError(msg);
      // Pick a fallback view the user can actually navigate from. Without
      // this the catch would leave `view` at its initial 'app' default,
      // which renders Dashboard with no underlying state and a Header
      // that hides every profile control because `activeUser` is null -
      // i.e. the "empty dashboard" trap.
      const fallbackUsers = useUserStore.getState().users;
      resetKoinkatAccountStore();
      setView(fallbackUsers.length > 0 ? 'userLogin' : 'userRegister');
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
    let cancelled = false;
    (async () => {
      if (!activeUser) {
        resetKoinkatAccountStore();
        if (cancelled) return;
        setView(users.length > 0 ? 'userLogin' : 'userRegister');
        return;
      }
      // User logged in → load their koinkat accounts and decide between
      // the hub and the app based on the active koinkat account.
      await loadAccounts(activeUser.id);
      await loadActiveKoinkatAccount();
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
    void (async () => {
      try {
        await bankLoadConfig();
        await bankLoadConnections();
        await useBankStore.getState().startSync();
      } catch (err) {
        console.warn('Workspace-switch bank init failed:', err);
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
      {bootstrapError && (
        <div
          role="alert"
          className="px-6 py-3 flex items-start gap-2 text-sm"
          style={{ color: 'var(--danger)' }}
        >
          <AlertCircle size={16} className="mt-[2px]" />
          <div className="flex flex-col gap-1">
            <strong>App failed to initialize</strong>
            <span style={{ color: 'var(--text-muted)' }}>{bootstrapError}</span>
            <button
              type="button"
              onClick={() => {
                setBootstrapError(null);
                window.location.reload();
              }}
              className="self-start underline text-xs cursor-pointer"
            >
              Reload
            </button>
          </div>
        </div>
      )}
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
