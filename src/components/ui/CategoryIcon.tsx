import {
  Utensils,
  Car,
  Home,
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
  MoreHorizontal,
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
 */
const ICON_MAP: Record<string, LucideIcon> = {
  Utensils,
  Car,
  Home,
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
  MoreHorizontal,
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
