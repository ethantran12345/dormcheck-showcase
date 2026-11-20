import figma from "@figma/code-connect";
import { NativeTopBar } from "@/components/NativeTopBar";

/**
 * Code Connect - NativeTopBar (iOS / native ONLY)
 * Figma file gCim7gGJjoF1Kvl463ddPu › 🧩 Components › "NATIVE TOP BAR".
 * Replaces GlobalTopNav inside the Capacitor shell. Takes no props - it reads auth, profile, and
 * unread-message state from hooks, and returns null when there is no signed-in user.
 */
figma.connect(
  NativeTopBar,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=23-2",
  {
    example: () => <NativeTopBar />,
  },
);
