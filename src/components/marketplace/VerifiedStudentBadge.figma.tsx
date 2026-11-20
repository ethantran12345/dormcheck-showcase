import figma from "@figma/code-connect";
import { VerifiedStudentBadge } from "@/components/marketplace/VerifiedStudentBadge";

/**
 * Code Connect - VerifiedStudentBadge (shared: web + iOS)
 * Figma file gCim7gGJjoF1Kvl463ddPu › 🧩 Components › "VERIFICATION BADGE".
 */

// "Verification/Verified" → default copy ("Verified Pitt Student").
figma.connect(
  VerifiedStudentBadge,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=20-25",
  {
    example: () => <VerifiedStudentBadge />,
  },
);

// "Verification/Match Verified" → custom label.
figma.connect(
  VerifiedStudentBadge,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=20-27",
  {
    example: () => <VerifiedStudentBadge label="Match Verified" />,
  },
);

// NOTE: Figma "Verification/Pending" (node 20-29) is intentionally UNMAPPED. The code badge only
// renders a verified (ShieldCheck) state - there is no "pending" variant. Tracked as a gap in the
// reconciliation table (docs/design-tokens.md / handoff report), not invented here.
