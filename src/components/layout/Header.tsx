import { Eye, EyeOff, Menu, User } from 'lucide-react';
import wordmarkGreen from '../../assets/koinkat-wordmark-green.png';
import wordmarkWhite from '../../assets/koinkat-wordmark-white.png';
import { useAppStore } from '../../stores/app-store';
import { useUiStore } from '../../stores/ui-store';
import { useUserStore } from '../../stores/user-store';
import { useKoinkatAccountStore } from '../../stores/koinkat-account-store';

interface HeaderProps {
  /** Show user chip + controls. Hidden on UserRegister/UserLogin. */
  showProfileControls?: boolean;
  /** Show the hamburger sidebar toggle. Only shown when inside an account. */
  showSidebarToggle?: boolean;
  /**
   * Current shell view. Used to decide whether to render the workspace name
   * in the chip (only rendered while inside a koinkat account, not at the hub).
   */
  view?: 'userRegister' | 'userLogin' | 'accountHub' | 'app';
}

export function Header({
  showProfileControls = true,
  showSidebarToggle = true,
  view = 'app',
}: HeaderProps) {
  const theme = useAppStore((s) => s.settings.theme);
  const privacyMode = useUiStore((s) => s.privacyMode);
  const togglePrivacy = useUiStore((s) => s.togglePrivacy);
  const toggleSidebar = useUiStore((s) => s.toggleSidebar);

  const activeUser = useUserStore((s) => s.activeUser);
  const activeKoinkatAccount = useKoinkatAccountStore((s) => s.activeKoinkatAccount);

  return (
    <header
      className="h-14 flex items-center justify-between px-4 border-b sticky top-0"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
        zIndex: 'var(--z-sticky)',
      }}
    >
      <div className="flex items-center gap-3">
        {showProfileControls && showSidebarToggle && (
          <button
            onClick={toggleSidebar}
            className="p-1.5 rounded-md transition-colors hover:opacity-80"
            style={{ color: 'var(--text-muted)' }}
            aria-label="Toggle sidebar"
          >
            <Menu size={20} />
          </button>
        )}
        <img
          src={theme === 'dark' ? wordmarkWhite : wordmarkGreen}
          alt="Koinkat"
          className="h-7 w-auto"
        />
      </div>

      <div className="flex items-center gap-1">
        <button
          onClick={togglePrivacy}
          className="p-2 rounded-md transition-colors hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
          aria-label={privacyMode ? 'Show values' : 'Hide values'}
          aria-pressed={privacyMode}
        >
          {privacyMode ? <EyeOff size={18} /> : <Eye size={18} />}
        </button>

        {showProfileControls && activeUser && (
          <div
            className="flex items-center gap-2 px-2 py-1 ml-2 rounded-md"
            style={{ backgroundColor: 'var(--input-bg)' }}
          >
            <User size={14} style={{ color: 'var(--text-muted)' }} />
            <span className="text-xs font-medium" style={{ color: 'var(--text)' }}>
              {activeUser.name}
            </span>
            {view === 'app' && activeKoinkatAccount && (
              <>
                <span style={{ color: 'var(--text-muted)' }}>·</span>
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {activeKoinkatAccount.name}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
