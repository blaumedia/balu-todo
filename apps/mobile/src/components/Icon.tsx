// Lucide icon wrapper (DESIGN §6 — Lucide everywhere, 1.5–2px stroke).
// A small explicit map keeps icon names typed and the bundle tree-shakeable.
import {
  Archive,
  ArrowLeft,
  Bell,
  Calendar,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Circle,
  Clock,
  Flag,
  Folder,
  Hash,
  Inbox,
  Layers,
  LogOut,
  Moon,
  MoreHorizontal,
  Plus,
  Repeat,
  Search,
  Server,
  Settings,
  Smartphone,
  Star,
  Sun,
  Sunset,
  Tag,
  Trash2,
  X,
  type LucideProps,
} from 'lucide-react-native';
import type { ComponentType } from 'react';

const MAP = {
  archive: Archive,
  'arrow-left': ArrowLeft,
  bell: Bell,
  calendar: Calendar,
  'calendar-days': CalendarDays,
  check: Check,
  'check-circle': CheckCircle2,
  'chevron-down': ChevronDown,
  'chevron-right': ChevronRight,
  circle: Circle,
  clock: Clock,
  flag: Flag,
  folder: Folder,
  hash: Hash,
  inbox: Inbox,
  layers: Layers,
  'log-out': LogOut,
  moon: Moon,
  'more-horizontal': MoreHorizontal,
  plus: Plus,
  repeat: Repeat,
  search: Search,
  server: Server,
  settings: Settings,
  smartphone: Smartphone,
  star: Star,
  sun: Sun,
  sunset: Sunset,
  tag: Tag,
  'trash-2': Trash2,
  x: X,
} satisfies Record<string, ComponentType<LucideProps>>;

export type IconName = keyof typeof MAP;

export interface IconProps {
  name: IconName;
  size?: number;
  color?: string;
  strokeWidth?: number;
  fill?: string;
}

export function Icon({ name, size = 20, color = '#000', strokeWidth = 2, fill = 'none' }: IconProps) {
  const Cmp = MAP[name];
  return <Cmp size={size} color={color} strokeWidth={strokeWidth} fill={fill} />;
}
