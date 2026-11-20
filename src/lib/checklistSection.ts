import type { ExploreProduct } from "@/types/exploreProduct";

/** Keyword sets per Shop Essentials explore filter category. */
const EXPLORE_CATEGORY_KEYWORDS: Record<string, string[]> = {
  Bedding: ["sleep", "bed"],
  Bath: ["bath", "laundry"],
  Storage: ["storage"],
  Tech: ["electronic", "tech"],
  Health: ["health", "wellness"],
  Decor: ["decor"],
  Kitchen: ["kitchen", "food"],
  Cleaning: ["cleaning"],
  "School Supplies": ["desk", "study", "school"],
};

/** Default checklist section when no existing section matches the explore category. */
const CANONICAL_SECTION_BY_EXPLORE_CATEGORY: Record<string, string> = {
  Bedding: "Sleep",
  Bath: "Bath / Laundry",
  Storage: "Storage",
  Tech: "Electronics",
  Health: "Health / Wellness",
  Decor: "Decor",
  Kitchen: "Kitchen / Food",
  Cleaning: "Cleaning",
  "School Supplies": "Desk / Study",
};

/** Shared with SetupDetailModal - keyword-based section guess from product title. */
export const CATEGORY_KEYWORDS: { category: string; keywords: string[] }[] = [
  {
    category: "Bath / Laundry",
    keywords: [
      "shower",
      "shampoo",
      "conditioner",
      "body wash",
      "soap",
      "towel",
      "bath",
      "laundry",
      "detergent",
      "dryer",
      "fabric softener",
      "hamper",
      "caddy",
      "robe",
      "loofa",
      "loofah",
      "razor",
      "toothbrush",
      "toothpaste",
      "floss",
      "deodorant",
      "cologne",
      "perfume",
      "face wash",
      "moisturizer",
      "skincare",
      "cotton",
      "q-tip",
      "nail",
      "hair dryer",
      "straightener",
      "curler",
      "brush",
      "comb",
      "mirror",
      "toilet",
      "plunger",
      "cleaning spray",
      "bleach",
      "scrubber",
      "sponge",
      "mop",
      "broom",
      "dustpan",
      "trash bag",
      "garbage bag",
      "air freshener",
      "febreze",
      "clorox",
      "lysol",
      "wipe",
      "disinfect",
    ],
  },
  {
    category: "Bedding",
    keywords: [
      "mattress",
      "topper",
      "pillow",
      "pillowcase",
      "sheet",
      "fitted sheet",
      "comforter",
      "duvet",
      "blanket",
      "quilt",
      "bedspread",
      "bed skirt",
      "mattress pad",
      "mattress cover",
      "sleeping bag",
      "memory foam",
      "twin xl",
      "twin-xl",
    ],
  },
  {
    category: "Desk / Study",
    keywords: [
      "desk",
      "lamp",
      "led lamp",
      "desk lamp",
      "monitor",
      "keyboard",
      "mouse",
      "mousepad",
      "mouse pad",
      "webcam",
      "usb hub",
      "usb-c",
      "hdmi",
      "cable",
      "charger",
      "power strip",
      "surge protector",
      "extension cord",
      "notebook",
      "binder",
      "folder",
      "pencil",
      "pen",
      "highlighter",
      "stapler",
      "tape",
      "scissors",
      "calculator",
      "whiteboard",
      "corkboard",
      "bulletin board",
      "sticky note",
      "post-it",
      "planner",
      "organizer",
      "drawer",
      "shelf",
      "bookend",
      "textbook",
      "backpack",
      "laptop",
      "tablet",
      "ipad",
      "stand",
      "lap desk",
      "headphones",
      "earbuds",
      "airpods",
    ],
  },
  {
    category: "Kitchen / Food",
    keywords: [
      "fridge",
      "mini fridge",
      "microwave",
      "kettle",
      "coffee maker",
      "keurig",
      "coffee",
      "mug",
      "cup",
      "plate",
      "bowl",
      "utensil",
      "fork",
      "spoon",
      "knife",
      "chopstick",
      "cutting board",
      "can opener",
      "bottle opener",
      "food container",
      "tupperware",
      "water bottle",
      "hydro flask",
      "stanley",
      "snack",
      "instant noodle",
      "ramen",
      "oatmeal",
      "protein bar",
      "dish soap",
      "sponge",
      "paper towel",
      "napkin",
      "plastic wrap",
      "aluminum foil",
      "ziploc",
      "storage bag",
    ],
  },
  {
    category: "Clothing / Storage",
    keywords: [
      "hanger",
      "clothes hanger",
      "hook",
      "over door",
      "over-door",
      "closet",
      "wardrobe",
      "dresser",
      "drawer organizer",
      "storage bin",
      "storage box",
      "storage cube",
      "cube organizer",
      "under bed",
      "under-bed",
      "vacuum bag",
      "space saver",
      "shoe rack",
      "shoe organizer",
      "boot",
      "sneaker",
      "laundry bag",
      "mesh bag",
      "lint roller",
    ],
  },
  {
    category: "Decor / Comfort",
    keywords: [
      "rug",
      "carpet",
      "curtain",
      "blackout",
      "tapestry",
      "poster",
      "picture frame",
      "frame",
      "string light",
      "fairy light",
      "led strip",
      "neon sign",
      "plant",
      "succulent",
      "candle",
      "diffuser",
      "essential oil",
      "wax melt",
      "throw pillow",
      "accent pillow",
      "bean bag",
      "floor pillow",
      "wall art",
      "wall decor",
      "clock",
      "calendar",
      "photo",
      "collage",
      "cork",
      "pin board",
      "flag",
      "banner",
    ],
  },
  {
    category: "Electronics / Misc",
    keywords: [
      "fan",
      "air circulator",
      "heater",
      "humidifier",
      "dehumidifier",
      "air purifier",
      "speaker",
      "bluetooth speaker",
      "alarm clock",
      "smart plug",
      "smart light",
      "roku",
      "fire stick",
      "chromecast",
      "hdtv",
      "television",
      "tv",
      "projector",
      "printer",
      "scanner",
      "shredder",
      "battery",
      "aa battery",
      "aaa battery",
      "flashlight",
      "first aid",
      "medicine",
      "vitamin",
      "thermometer",
      "scale",
      "safe",
      "lock",
      "padlock",
      "bike lock",
    ],
  },
  {
    category: "Moving",
    keywords: [
      "moving box",
      "moving bag",
      "packing",
      "bubble wrap",
      "packing tape",
      "label",
      "marker",
      "dolly",
      "cart",
      "luggage",
      "suitcase",
      "duffel",
      "tote bag",
      "reusable bag",
    ],
  },
];

export function categorizeProductName(name: string): string {
  const lower = name.toLowerCase();
  for (const { category, keywords } of CATEGORY_KEYWORDS) {
    for (const kw of keywords) {
      if (lower.includes(kw)) {
        return category;
      }
    }
  }
  return "Uncategorized";
}

function findExistingSectionByKeywords(
  keywords: string[],
  existingSections: string[],
): string | null {
  for (const kw of keywords) {
    const match = existingSections.find((section) => section.toLowerCase().includes(kw));
    if (match) return match;
  }
  return null;
}

function matchCategorizedToExisting(categorized: string, existingSections: string[]): string | null {
  const catLower = categorized.toLowerCase();
  const exact = existingSections.find((s) => s.toLowerCase() === catLower);
  if (exact) return exact;

  const partial = existingSections.find((s) => {
    const sl = s.toLowerCase();
    return sl.includes(catLower) || catLower.includes(sl);
  });
  if (partial) return partial;

  const entry = CATEGORY_KEYWORDS.find((e) => e.category === categorized);
  if (entry) {
    return findExistingSectionByKeywords(entry.keywords, existingSections);
  }
  return null;
}

/**
 * Pick a checklist section for a Shop Essentials product.
 * Prefers existing user sections (renamed / apartment templates) over canonical defaults.
 */
export function resolveChecklistSection(
  product: Pick<ExploreProduct, "name" | "category">,
  existingSections: string[],
): string {
  const exploreCategory = product.category?.trim();

  if (exploreCategory && EXPLORE_CATEGORY_KEYWORDS[exploreCategory]) {
    const keywords = EXPLORE_CATEGORY_KEYWORDS[exploreCategory];
    const existing = findExistingSectionByKeywords(keywords, existingSections);
    if (existing) return existing;
    return CANONICAL_SECTION_BY_EXPLORE_CATEGORY[exploreCategory] ?? exploreCategory;
  }

  const categorized = categorizeProductName(product.name);
  const fromName = matchCategorizedToExisting(categorized, existingSections);
  if (fromName) return fromName;
  if (categorized !== "Uncategorized") return categorized;

  // No explore-category, no keyword name-guess: bucket into "Unsorted" rather
  // than silently dumping into whatever section happens to be first (was Bedding).
  return "Unsorted";
}
