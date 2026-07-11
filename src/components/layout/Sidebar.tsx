import { NavLink } from 'react-router-dom';
import {
  LayoutDashboard,
  ArrowLeftRight,
  PieChart,
  BarChart3,
  Wallet,
  Layers,
  ListChecks,
  SettingsIcon,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppStore } from '../../stores/app-store';

interface NavItem {
  to: string;
  label: string;
  icon: LucideIcon;
  /** If set to 'review', renders a pending-review count badge. */
  badge?: 'review';
}

// Primary navigation - top of the sidebar, rendered in order.
//
// NOTE: The Rules page is intentionally NOT listed here. It lives at the
// `/rules` route for internal use (debugging the categorization engine,
// manual rule edits during development), but we don't want to expose it
// as a user-facing navigation target.
const NAV_ITEMS: NavItem[] = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/review', label: 'Review', icon: ListChecks, badge: 'review' },
  { to: '/transactions', label: 'Transactions', icon: ArrowLeftRight },
  { to: '/analysis', label: 'Analysis', icon: PieChart },
  { to: '/summary', label: 'Summary', icon: BarChart3 },
  { to: '/budgets', label: 'Budgets', icon: Wallet },
  { to: '/categories', label: 'Categories', icon: Layers },
];

// Settings always sits at the bottom of the sidebar, separated from the
// primary nav by a flex spacer.
const FOOTER_ITEM: NavItem = {
  to: '/settings',
  label: 'Settings',
  icon: SettingsIcon,
};

export function Sidebar() {
  const pendingReviewCount = useAppStore((s) => s.pendingReviewCount);

  function renderNavLink({ to, label, icon: Icon, badge }: NavItem) {
    return (
      <NavLink
        key={to}
        to={to}
        end={to === '/'}
        className={({ isActive }) => `kk-nav-item${isActive ? ' kk-nav-active' : ''}`}
      >
        <Icon size={20} strokeWidth={1.75} />
        <span className="flex-1">{label}</span>
        {badge === 'review' && pendingReviewCount > 0 && (
          <span
            className="px-1.5 py-0.5 rounded-full"
            style={{
              backgroundColor:
                'color-mix(in srgb, var(--primary) 18%, transparent)',
              color: 'var(--primary)',
              fontSize: 'var(--fs-rate)',
              fontWeight: 'var(--fw-medium)',
              fontFamily: 'var(--font-mono)',
            }}
          >
            {pendingReviewCount}
          </span>
        )}
      </NavLink>
    );
  }

  return (
    <aside
      className="w-[220px] shrink-0 self-start sticky top-14 h-[calc(100vh-3.5rem)] border-r py-4 px-3 flex flex-col"
      style={{
        backgroundColor: 'var(--surface)',
        borderColor: 'var(--border)',
      }}
    >
      <nav className="flex flex-col gap-0.5">
        {NAV_ITEMS.map((item) => renderNavLink(item))}
      </nav>

      {/* Footer - pinned to the bottom of the sidebar. */}
      <nav className="mt-auto flex flex-col gap-0.5 pt-4">
        {renderNavLink(FOOTER_ITEM)}
      </nav>
    </aside>
  );
}
