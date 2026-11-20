import type { ComponentType, SVGProps } from 'react';
import { Link as LinkIcon } from 'lucide-react';
import { SiSnapchat, SiGroupme, SiWhatsapp, SiDiscord } from 'react-icons/si';

export type ChatPlatform = 'snapchat' | 'groupme' | 'whatsapp' | 'discord' | 'other';

export const CHAT_PLATFORMS: ChatPlatform[] = ['snapchat', 'groupme', 'whatsapp', 'discord', 'other'];

interface PlatformConfig {
  id: ChatPlatform;
  label: string;
  /** Short hint shown under the URL input */
  hint: string;
  /** Regex for client-side validation. MUST match SQL chk_url_per_platform
   *  in migration 20260514223622. */
  pattern: RegExp;
  /** Example URL shown in the input placeholder */
  example: string;
  /** Icon component - either Lucide or react-icons */
  icon: ComponentType<{ className?: string; size?: number | string } & SVGProps<SVGSVGElement>>;
  /** Tailwind classes for the brand-colored icon */
  iconClass: string;
}

export const PLATFORM_CONFIG: Record<ChatPlatform, PlatformConfig> = {
  snapchat: {
    id: 'snapchat',
    label: 'Snapchat',
    hint: 'Group invite link from Snapchat',
    pattern: /^https:\/\/t\.snapchat\.com\/[A-Za-z0-9_-]+\/?(\?.*)?$/i,
    example: 'https://t.snapchat.com/AbC123',
    icon: SiSnapchat,
    iconClass: 'text-yellow-500',
  },
  groupme: {
    id: 'groupme',
    label: 'GroupMe',
    hint: 'Join link from GroupMe',
    pattern: /^https:\/\/groupme\.com\/join_group\/\d+\/[A-Za-z0-9]+\/?$/i,
    example: 'https://groupme.com/join_group/12345/abc123',
    icon: SiGroupme,
    iconClass: 'text-blue-500',
  },
  whatsapp: {
    id: 'whatsapp',
    label: 'WhatsApp',
    hint: 'Group invite link from WhatsApp',
    pattern: /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+\/?$/i,
    example: 'https://chat.whatsapp.com/AbC123',
    icon: SiWhatsapp,
    iconClass: 'text-green-500',
  },
  discord: {
    id: 'discord',
    label: 'Discord',
    hint: 'Invite link from Discord',
    pattern: /^https:\/\/(discord\.gg|discord(app)?\.com\/invite)\/[A-Za-z0-9-]+\/?$/i,
    example: 'https://discord.gg/AbC123',
    icon: SiDiscord,
    iconClass: 'text-indigo-500',
  },
  other: {
    id: 'other',
    label: 'Other',
    hint: 'Any HTTPS link',
    pattern: /^https:\/\/[^\s<>"]+$/i,
    example: 'https://example.com/chat',
    icon: LinkIcon,
    iconClass: 'text-muted-foreground',
  },
};

/**
 * Validate a URL against a platform's regex. Returns true if valid.
 */
export function isValidPlatformUrl(url: string, platform: ChatPlatform): boolean {
  const config = PLATFORM_CONFIG[platform];
  return config.pattern.test(url.trim());
}
