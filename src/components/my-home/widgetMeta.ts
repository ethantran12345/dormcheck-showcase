import type { LucideIcon } from 'lucide-react';
import {
  Activity,
  Bell,
  Bookmark,
  Boxes,
  CalendarDays,
  Building2,
  ClipboardCheck,
  MessageCircle,
  Navigation,
  Sparkles,
  ShoppingBag,
  Radio,
  Truck,
  Users,
} from 'lucide-react';
import type { MyHomeTileSize, MyHomeWidgetId } from '@/lib/myHomeLayout';
import type { WidgetTint } from './widgetTints';

/** Icon shown for each widget in previews (mirrors the real tile's header icon). */
export const MY_HOME_WIDGET_ICON: Record<MyHomeWidgetId, LucideIcon> = {
  setup_guide: Sparkles,
  notifications: Bell,
  checklist: ClipboardCheck,
  schedule: CalendarDays,
  campus_live: Radio,
  move_logistics: Truck,
  resources: Boxes,
  your_dorm: Building2,
  getting_around: Navigation,
  roommate_group: Users,
  marketplace_dorm: ShoppingBag,
  messages: MessageCircle,
  roommate_matches: Users,
  your_roommate_post: Users,
  your_listings: ShoppingBag,
  saved: Bookmark,
  activity_feed: Activity,
};

/** Pastel accent for each widget - kept in sync with the tints used on the tiles. */
export const MY_HOME_WIDGET_TINT: Record<MyHomeWidgetId, WidgetTint> = {
  setup_guide: 'green',
  notifications: 'green',
  checklist: 'green',
  schedule: 'green',
  campus_live: 'green',
  move_logistics: 'sky',
  resources: 'green',
  your_dorm: 'violet',
  getting_around: 'sky',
  roommate_group: 'green',
  marketplace_dorm: 'amber',
  messages: 'blue',
  roommate_matches: 'rose',
  your_roommate_post: 'rose',
  your_listings: 'amber',
  saved: 'rose',
  activity_feed: 'green',
};

/** Human label for a tile's layout role, shown under the widget name in customize. */
export const MY_HOME_TILE_SIZE_LABEL: Record<MyHomeTileSize, string> = {
  hero: 'Featured tile',
  square: 'Small tile · pairs up',
  wide: 'Wide card',
  scroller: 'Scrolling row',
};
