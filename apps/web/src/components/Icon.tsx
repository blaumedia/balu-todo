import {
  AlignLeft,
  Archive,
  AtSign,
  Bell,
  Building2,
  Calendar,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsUpDown,
  Circle,
  CircleCheck,
  Clock,
  Copy,
  CornerDownLeft,
  Eye,
  EyeOff,
  FileText,
  Flag,
  GripVertical,
  Hash,
  Inbox,
  KeyRound,
  Layers,
  Link2,
  LogIn,
  LogOut,
  Mail,
  MessageCircle,
  Monitor,
  Moon,
  Paperclip,
  Plus,
  RefreshCw,
  Repeat,
  Search,
  Send,
  Settings,
  Star,
  Sun,
  Sunset,
  Trash2,
  UserCheck,
  Users,
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
  bell: Bell,
  "building-2": Building2,
  calendar: Calendar,
  "calendar-days": CalendarDays,
  check: Check,
  "check-circle": CircleCheck,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevrons-up-down": ChevronsUpDown,
  circle: Circle,
  clock: Clock,
  copy: Copy,
  "corner-down-left": CornerDownLeft,
  eye: Eye,
  "eye-off": EyeOff,
  "file-text": FileText,
  flag: Flag,
  "grip-vertical": GripVertical,
  hash: Hash,
  inbox: Inbox,
  key: KeyRound,
  layers: Layers,
  "link-2": Link2,
  "log-in": LogIn,
  "log-out": LogOut,
  mail: Mail,
  "message-circle": MessageCircle,
  monitor: Monitor,
  moon: Moon,
  paperclip: Paperclip,
  plus: Plus,
  "refresh-cw": RefreshCw,
  repeat: Repeat,
  search: Search,
  send: Send,
  settings: Settings,
  star: Star,
  sun: Sun,
  sunset: Sunset,
  "trash-2": Trash2,
  "user-check": UserCheck,
  users: Users,
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
