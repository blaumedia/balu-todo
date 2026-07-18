import {
  AlignLeft,
  Archive,
  AtSign,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  Circle,
  CircleCheck,
  Clock,
  Flag,
  Hash,
  Inbox,
  Layers,
  LogOut,
  Monitor,
  Moon,
  Plus,
  Repeat,
  Search,
  Settings,
  Star,
  Sun,
  Sunset,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import type { CSSProperties } from "react";

// Lucide is the single icon system (DESIGN §6). We reference glyphs by the
// kebab names used across the design system and inherit currentColor + size.
const ICONS: Record<string, LucideIcon> = {
  "align-left": AlignLeft,
  archive: Archive,
  "at-sign": AtSign,
  calendar: Calendar,
  "calendar-days": CalendarDays,
  check: Check,
  "check-circle": CircleCheck,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  circle: Circle,
  clock: Clock,
  flag: Flag,
  hash: Hash,
  inbox: Inbox,
  layers: Layers,
  "log-out": LogOut,
  monitor: Monitor,
  moon: Moon,
  plus: Plus,
  repeat: Repeat,
  search: Search,
  settings: Settings,
  star: Star,
  sun: Sun,
  sunset: Sunset,
  "trash-2": Trash2,
  x: X,
};

export interface IconProps {
  name: string;
  size?: number;
  strokeWidth?: number;
  color?: string;
  style?: CSSProperties;
  fill?: string;
}

export function Icon({ name, size = 20, strokeWidth = 2, color = "currentColor", style, fill = "none" }: IconProps) {
  const Cmp = ICONS[name] ?? Circle;
  return (
    <Cmp
      size={size}
      strokeWidth={strokeWidth}
      color={color}
      fill={fill}
      style={{ display: "block", flex: "none", ...style }}
      aria-hidden
    />
  );
}
