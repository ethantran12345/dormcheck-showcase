import figma from "@figma/code-connect";
import { DormCard } from "@/components/DormCard";
import type { Dorm } from "@/types";

/**
 * Code Connect - DormCard (shared: web + iOS)
 * Figma file gCim7gGJjoF1Kvl463ddPu › 🧩 Components › "DORMCARD · signature".
 * `dorm` is a real Supabase-backed data object; declared here as a placeholder so the snippet stays
 * focused on the wiring (hero image, rating, audience/room badges, favorite heart, optional CTA).
 */
declare const exampleDorm: Dorm;

figma.connect(
  DormCard,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=25-2",
  {
    example: () => (
      <DormCard
        dorm={exampleDorm}
        isLoggedIn
        isSaved={false}
        onClick={() => {}}
        onToggleSave={() => {}}
      />
    ),
  },
);
