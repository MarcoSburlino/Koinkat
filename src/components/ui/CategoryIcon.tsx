import {
  Utensils,
  Car,
  House,
  Zap,
  ShoppingBag,
  Heart,
  Clapperboard,
  Plane,
  RefreshCw,
  Sparkles,
  GraduationCap,
  Landmark,
  Shield,
  Gift,
  Baby,
  PawPrint,
  Receipt,
  Ellipsis,
  Briefcase,
  Laptop,
  TrendingUp,
  RotateCcw,
  Folder,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

/**
 * String-name → Lucide component map for seeded + user-chosen category
 * icons. Unknown names fall back to a generic `Folder` glyph so the UI
 * never hard-crashes on a typo.
 *
 * The keys are a persisted contract, not just local identifiers: they are
 * the exact strings stored in the `icon` column and seeded by
 * `src/db/seed.ts`. Lucide renamed two of these components in v1
 * (`Home` to `House`, `MoreHorizontal` to `Ellipsis`), so those entries are
 * written out longhand. Letting the shorthand carry the new component name
 * would rename the KEY too, and every database already on disk would miss
 * the lookup and fall through to `Folder` with no error anywhere.
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Utensils,
  Car,
  Home: House,
  Zap,
  ShoppingBag,
  Heart,
  Clapperboard,
  Plane,
  RefreshCw,
  Sparkles,
  GraduationCap,
  Landmark,
  Shield,
  Gift,
  Baby,
  PawPrint,
  Receipt,
  MoreHorizontal: Ellipsis,
  Briefcase,
  Laptop,
  TrendingUp,
  RotateCcw,
};

interface CategoryIconProps {
  name: string | null | undefined;
  size?: number;
  strokeWidth?: number;
  color?: string;
  className?: string;
}

export function CategoryIcon({
  name,
  size = 16,
  strokeWidth = 1.75,
  color,
  className,
}: CategoryIconProps) {
  const lookup = name ? ICON_MAP[name] : undefined;
  const Icon: LucideIcon = lookup ?? Folder;
  return (
    <Icon
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      className={className}
    />
  );
}
