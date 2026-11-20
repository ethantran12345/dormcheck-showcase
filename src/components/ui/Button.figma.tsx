import figma from "@figma/code-connect";
import { Button } from "@/components/ui/button";

/**
 * Code Connect - Button (shared: web + iOS)
 * Figma file gCim7gGJjoF1Kvl463ddPu › 🧩 Components.
 * Figma models Primary/Secondary as two separate components; code is one Button with a `variant`.
 */

// "Button/Primary" → default (brand green) variant.
figma.connect(
  Button,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=20-7",
  {
    example: () => <Button variant="default">Primary action</Button>,
  },
);

// "Button/Secondary" → secondary (slate) variant.
figma.connect(
  Button,
  "https://www.figma.com/design/gCim7gGJjoF1Kvl463ddPu?node-id=20-9",
  {
    example: () => <Button variant="secondary">Secondary action</Button>,
  },
);
