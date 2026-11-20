import figma from "@figma/code-connect";
import { BottomNav } from "@/components/BottomNav";

/**
 * Code Connect - BottomNav (iOS / native ONLY)
 * Figma file gCim7gGJjoF1Kvl463ddPu › 🧩 Components › "BOTTOM NAV".
 * Returns null when !Capacitor.isNativePlatform(). The Figma Pilot/Admin split is feature SCOPE
 * (which tabs show), decided upstream by useFeatureFlags + admin role - NOT a component prop. So all
 * three Figma nodes map to the one code component.
 */

// "BottomNav" - base.
figma.connect(
  BottomNav,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=23-16",
  {
    example: () => <BottomNav activeTab="campus" />,
  },
);

// "BottomNav/Pilot" - Phase-1 tab set (Checklist + Marketplace) shown to non-admin pilot users.
figma.connect(
  BottomNav,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=48-6",
  {
    example: () => <BottomNav activeTab="campus" />,
  },
);

// "BottomNav/Admin" - full-app tab set surfaced under admin preview. Same component.
figma.connect(
  BottomNav,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=48-27",
  {
    example: () => <BottomNav activeTab="campus" />,
  },
);
