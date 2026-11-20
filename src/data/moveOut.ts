/**
 * Move-out ladder: every way to deal with your stuff at the end of the year,
 * ordered cheapest to priciest. The trade the ladder captures: cheaper means
 * more effort you do yourself, pricier means they do it for you.
 *
 * Content is curated and static. Prices are ballpark ranges to set
 * expectations, never quotes; each paid option carries a priceNote telling
 * the student to confirm on the provider's own site.
 */

import { DEFAULT_UNIVERSITY } from "@/config/universities";

export type Effort = "you-haul" | "they-help" | "white-glove";

export type PriceBand = "earn" | "free" | "$" | "$$" | "$$$";

/** Rungs whose expanded content is an existing rich wizard component rather
 *  than a plain step list. The rendering component maps these ids to nodes. */
export type MoveOutDetailSlot = "ship2home-wizard" | "storepitt-wizard";

export interface MoveOutOption {
  id: string;
  name: string;
  tagline: string;
  priceBand: PriceBand;
  priceLabel: string;
  priceNote?: string;
  effort: Effort;
  effortLabel: string;
  bestFor: string;
  /** Numbered directions. Empty when `detail` supplies the expanded content. */
  steps: string[];
  /** Omitted for wizard rungs whose CTA lives inside the wizard.
   *  `state` is passed to react-router navigate() for internal CTAs. */
  cta?: { label: string; href: string; internal?: boolean; state?: Record<string, unknown> };
  seasonalNote?: string;
  /** Partner/monetizable link candidate. Plain link for now. */
  affiliate?: boolean;
  detail?: MoveOutDetailSlot;
  /** Visually highlight this card (ring treatment). */
  featured?: boolean;
  /** Short callout chip, e.g. "Zero effort". */
  tag?: string;
}

export interface MoveOutTier {
  id: string;
  heading: string;
  subheading: string;
  options: MoveOutOption[];
}

export const EFFORT_LABELS: Record<Effort, string> = {
  "you-haul": "You haul it",
  "they-help": "They help",
  "white-glove": "White glove",
};

export const MOVE_OUT_TIERS: MoveOutTier[] = [
  {
    id: "get-it-gone",
    heading: "Get it gone: earn cash or donate free",
    subheading: "The cheapest options pay you or cost nothing. Keep good stuff out of the dumpster.",
    options: [
      {
        id: "marketplace",
        name: "Sell it on DormCheck Marketplace",
        tagline: "Turn your dorm stuff into money before you leave.",
        priceBand: "earn",
        priceLabel: "You get paid",
        effort: "you-haul",
        effortLabel: "List it, meet the buyer on campus",
        bestFor: "Anything still good: mini fridge, futon, textbooks, decor",
        steps: [
          'Open the DormCheck Marketplace and tap "Post an Item."',
          "Snap a photo, set a price, post it. Takes under a minute.",
          "Chat with buyers in-app and meet somewhere on campus to hand it off.",
          "Repeat for anything you'd otherwise leave behind. Cash beats the curb.",
        ],
        cta: {
          label: "Sell on Marketplace",
          href: "/marketplace?tab=buy-sell",
          internal: true,
          state: { openPostDialog: "general" },
        },
        featured: true,
      },
      {
        id: "pitt-clean-out",
        name: "Pitt Move Out Clean Out",
        tagline: "Pitt already runs this donation drive. Drop your stuff at a tent on the way out.",
        priceBand: "free",
        priceLabel: "Free",
        effort: "you-haul",
        effortLabel: "Carry it to a campus donation tent",
        bestFor: "Good stuff you don't want to haul home",
        seasonalNote: "Runs during finals and move-out, roughly late April to early May. Confirm dates each year.",
        steps: [
          "Box up dorm essentials worth reusing: lamps, mirrors, bins, dry-erase boards, laundry baskets, clothing organizers. Electronics are accepted too (TVs, monitors, keyboards, cables, chargers).",
          'Carry them to the nearest donation station: the Schenley Quad tent (between Amos and McCormick), the Litchfield Towers lobby (across from Panther Central), or the Sutherland Hall tent (Sutherland "U" parking lot).',
          "Hand items to the volunteers during open hours. No form, no fee.",
          "Done. It stays out of the landfill and gets reused by other students.",
        ],
        cta: { label: "Pitt Move Out Clean Out info", href: "https://www.bhas.pitt.edu/move-out-clean-out" },
      },
      {
        id: "thriftsburgh",
        name: "Thriftsburgh",
        tagline: "Pitt's student-run thrift store in O'Hara 111. Donations can earn store credit.",
        priceBand: "free",
        priceLabel: "Free",
        effort: "you-haul",
        effortLabel: "Drop it off during store hours",
        bestFor: "Clean clothing, shoes, and accessories",
        steps: [
          "Sort out clean clothing, shoes, and accessories in good shape.",
          "Bring them to Thriftsburgh in O'Hara Student Center room 111 during store hours.",
          "Donate at the counter. You may get store credit for your next find.",
        ],
        cta: {
          label: "Thriftsburgh info",
          href: "https://www.studentaffairs.pitt.edu/care-and-resources/thriftsburgh",
        },
      },
      {
        id: "goodwill",
        name: "Off-campus donation drop-off",
        tagline: "Missed the campus tents? Drop at a nearby donation center.",
        priceBand: "free",
        priceLabel: "Free",
        effort: "you-haul",
        effortLabel: "Drive or walk it to a drop-off",
        bestFor: "Clothes, housewares, anything after the campus drive ends",
        steps: [
          "Bag clothing and boxable housewares separately.",
          "Find the closest Goodwill or thrift drop-off in Oakland or Pittsburgh (link below).",
          "Check their hours and drop it at the donation door. Ask for a receipt if you want the tax write-off.",
        ],
        cta: { label: "Goodwill donation info", href: "https://www.goodwillswpa.org/donate" },
      },
    ],
  },
  {
    id: "ship-or-store-yourself",
    heading: "Cheapest ways to ship or store it yourself",
    subheading: "You do the packing and hauling, so you pay the least.",
    options: [
      {
        id: "ship2home",
        name: "Ship2Home (Pitt Logistics)",
        tagline: "Pitt's own ship-home program. Drop unsealed boxes at Tower B, no car needed.",
        priceBand: "$",
        priceLabel: "$120 for 2 boxes",
        priceNote: "Pricing and dates are Pitt Logistics' own. Confirm on their site.",
        effort: "you-haul",
        effortLabel: "Pack boxes, drop at Tower B",
        bestFor: "On-campus students shipping a couple boxes home without a car",
        steps: [],
        detail: "ship2home-wizard",
      },
      {
        id: "ups-store",
        name: "Ship it home (The UPS Store on Forbes)",
        tagline: "Only a few boxes? Mail them home instead of storing.",
        priceBand: "$",
        priceLabel: "About $20 to $60 per box",
        priceNote: "Varies by size and distance. Get exact pricing in-store or online.",
        effort: "you-haul",
        effortLabel: "Pack boxes, carry to the store",
        bestFor: "A small amount of stuff going to your home address",
        steps: [
          "Pack what you're keeping into sturdy boxes.",
          "Bring them to The UPS Store at 3945 Forbes Ave, in Oakland on campus.",
          "They'll weigh, quote, and ship to your home address, or store short-term if offered.",
        ],
        cta: {
          label: "UPS Store on Forbes Ave",
          href: "https://locations.theupsstore.com/pa/pittsburgh/3945-forbes-ave",
        },
      },
      {
        id: "self-storage",
        name: "Self-storage unit (STORExpress / EZ Storage)",
        tagline: "Rent a unit and move your stuff yourself. Cheapest way to store a lot.",
        priceBand: "$",
        priceLabel: "About $30 to $90/month",
        priceNote: "Confirm current rates and summer specials online.",
        effort: "you-haul",
        effortLabel: "You rent, transport, load, and unload it",
        bestFor: "A whole room's worth of stuff on a tight budget, if you have a way to move it",
        steps: [
          "Book a small unit online. STORExpress is close to campus; EZ Storage's Green Tree location is about 20 minutes out and often cheaper.",
          "Arrange transport: your car, a friend's, or a cheap van rental.",
          "Move your stuff in yourself, and set up autopay so you don't miss a payment over the summer.",
          "Come back in August and haul it to your new place.",
        ],
        cta: {
          label: "Compare self-storage near Pitt",
          href: "https://www.storexpressselfstorage.com/student-storage",
        },
      },
    ],
  },
  {
    id: "they-help",
    heading: "They help: pickup plus storage",
    subheading: "You pack, they pick up from your dorm and store it. You pay per item or plan.",
    options: [
      {
        id: "storepitt",
        name: "Store@Pitt (Don Farr Moving)",
        tagline: "Pitt's coordinated summer storage program, run with Don Farr Moving.",
        priceBand: "$$",
        priceLabel: "Plans from $50",
        priceNote: "Plan pricing is Don Farr's own. Confirm and book with them directly.",
        effort: "they-help",
        effortLabel: "You pack, they store and deliver back",
        bestFor: "On-campus students who want an official Pitt storage route",
        steps: [],
        detail: "storepitt-wizard",
      },
      {
        id: "storage-squad",
        name: "Storage Squad",
        tagline: "They pick up from your dorm and store it. You pay per item or box.",
        priceBand: "$$",
        priceLabel: "About $100 to $300 for the summer",
        priceNote: "Price scales with item count. Get a quote on their site.",
        effort: "they-help",
        effortLabel: "You pack; they pick up, store, and redeliver",
        bestFor: "You want pickup but want to control cost by item count",
        steps: [
          "Reserve a pickup slot online during move-out week.",
          "Pack and label your boxes and items (they provide supplies and guidance).",
          "They collect from your dorm on the scheduled day.",
          "Everything is stored over summer and delivered back to your new room in the fall.",
        ],
        // TODO: swap to affiliate/referral link once partnership is signed
        cta: {
          label: "Get a Storage Squad quote",
          href: "https://storagesquad.com/summer-storage/university-of-pittsburgh/",
        },
        affiliate: true,
      },
    ],
  },
  {
    id: "white-glove",
    heading: "White glove: they do everything",
    subheading: "The priciest rung. They pack, pick up, store, and bring it all back.",
    options: [
      {
        id: "storage-scholars",
        name: "Storage Scholars",
        tagline: "Don't lift a finger. They pack, pick up, store, and bring it back.",
        priceBand: "$$$",
        priceLabel: "About $300 to $500+ all-in",
        priceNote: "All-inclusive packages vary. Request a quote on their site.",
        effort: "white-glove",
        effortLabel: "They handle packing, pickup, storage, and return delivery",
        bestFor: "You're slammed with finals, have no car, and will pay to make it disappear and reappear",
        tag: "Zero effort",
        steps: [
          "Book online and pick your pickup date.",
          "Optionally add packing service so they box everything for you.",
          "They come to your room, take everything, and store it climate-controlled.",
          "In the fall, they deliver it straight to your new room. One price, zero hauling.",
        ],
        // TODO: swap to affiliate/referral link once partnership is signed
        cta: {
          label: "Storage Scholars at Pitt",
          href: "https://www.storagescholars.com/schools/university-of-pittsburgh-college-shipping-storage-moving-pittsburgh-pa",
        },
        affiliate: true,
      },
    ],
  },
];

/**
 * Move-out content keyed by university slug (see `src/config/universities.ts`).
 * Pitt is the only entry until university #2 lands; unknown slugs fall back to
 * the default university's content.
 */
const MOVE_OUT_CONTENT: Record<string, MoveOutTier[]> = {
  pitt: MOVE_OUT_TIERS,
  cmu: [
    {
      id: "cmu-reuse",
      heading: "Reuse it before you haul it",
      subheading: "Sell useful items locally or donate through CMU's official move-out collection.",
      options: [
        {
          id: "cmu-marketplace",
          name: "Sell it on DormCheck Marketplace",
          tagline: "Pass useful dorm items to another verified Pittsburgh student.",
          priceBand: "earn",
          priceLabel: "You get paid",
          effort: "you-haul",
          effortLabel: "List it and meet the buyer",
          bestFor: "Furniture, appliances, textbooks, storage, and decor in usable condition",
          steps: [
            "Post clear photos and describe the item's condition.",
            "Use in-app messages to agree on a public campus meetup.",
            "Complete the handoff before your residence closes.",
          ],
          cta: { label: "Sell on Marketplace", href: "/marketplace?tab=buy-sell", internal: true },
          featured: true,
        },
        {
          id: "cmu-whatever-drive",
          name: "CMU Whatever Drive",
          tagline: "Donate usable belongings through CMU's official move-out diversion program.",
          priceBand: "free",
          priceLabel: "Free",
          effort: "you-haul",
          effortLabel: "Bring accepted items to the announced collection point",
          bestFor: "Usable items you do not want to take home",
          seasonalNote: "Collection details change annually; confirm the current instructions before carrying items over.",
          steps: [
            "Review the current move-out page and collection instructions.",
            "Separate usable donations from trash and prohibited items.",
            "Bring accepted items to the official collection point during posted hours.",
          ],
          cta: { label: "CMU move-out guidance", href: "https://www.cmu.edu/housing/move-out/" },
        },
      ],
    },
    {
      id: "cmu-pack",
      heading: "Pack and leave clean",
      subheading: "Finish your official checkout without leaving belongings or waste behind.",
      options: [
        {
          id: "cmu-self-haul",
          name: "Pack and transport it yourself",
          tagline: "The reliable fallback when you are keeping your belongings.",
          priceBand: "$",
          priceLabel: "Transportation varies",
          priceNote: "Confirm any vehicle, shipping, or storage cost directly with the provider.",
          effort: "you-haul",
          effortLabel: "You pack, load, and transport",
          bestFor: "Items you need next term or at home",
          steps: [
            "Confirm your checkout time with your RA.",
            "Pack early and reserve transportation before finals week.",
            "Remove all belongings and trash, then complete the required checkout process.",
          ],
          cta: { label: "Official checkout checklist", href: "https://www.cmu.edu/housing/move-out/" },
        },
      ],
    },
  ],
  carlow: [
    {
      id: "carlow-reuse",
      heading: "Sell, donate, or take it home",
      subheading: "Start with reuse, then make a transport plan before the residence deadline.",
      options: [
        {
          id: "carlow-marketplace",
          name: "Sell it on DormCheck Marketplace",
          tagline: "Pass useful belongings to another verified Pittsburgh student.",
          priceBand: "earn",
          priceLabel: "You get paid",
          effort: "you-haul",
          effortLabel: "List it and meet the buyer",
          bestFor: "Usable furniture, appliances, books, storage, and decor",
          steps: [
            "Post clear photos and an honest condition description.",
            "Arrange a public campus meetup in messages.",
            "Complete the handoff before your residence closes.",
          ],
          cta: { label: "Sell on Marketplace", href: "/marketplace?tab=buy-sell", internal: true },
          featured: true,
        },
        {
          id: "carlow-donate",
          name: "Donate usable items locally",
          tagline: "Confirm acceptance before taking belongings to a nonprofit or collection site.",
          priceBand: "free",
          priceLabel: "Usually free",
          effort: "you-haul",
          effortLabel: "You sort and transport accepted items",
          bestFor: "Clean, working belongings that did not sell",
          steps: [
            "Ask Residence Life whether a campus collection is operating this term.",
            "If not, contact a local nonprofit and confirm its accepted-item list and hours.",
            "Do not leave donations in hallways, lounges, or outside a closed collection site.",
          ],
          cta: { label: "Contact Carlow Residence Life", href: "https://www.carlow.edu/student-life/campus-life/housing/" },
        },
      ],
    },
    {
      id: "carlow-checkout",
      heading: "Finish the residence checkout",
      subheading: "Carlow housing closes at the calendar's posted time; plan backward from it.",
      options: [
        {
          id: "carlow-self-haul",
          name: "Pack and transport it yourself",
          tagline: "Keep what you need and leave the room empty and clean.",
          priceBand: "$",
          priceLabel: "Transportation varies",
          priceNote: "Confirm any vehicle, shipping, or storage cost directly with the provider.",
          effort: "you-haul",
          effortLabel: "You pack, load, and transport",
          bestFor: "Items you need next term or at home",
          steps: [
            "Check the official academic calendar for the residence closing time.",
            "Confirm your building's checkout steps with Residence Life or your RA.",
            "Remove all belongings and trash before completing checkout.",
          ],
          cta: { label: "Carlow academic calendar", href: "https://www.carlow.edu/academic-programs/academic-information/academic-calendar/" },
        },
      ],
    },
  ],
};

/**
 * True when curated move-out content exists for the slug. Universities without
 * an entry (e.g. CMU at activation) should get an empty state, not Pitt content.
 */
export function hasMoveOutContent(slug: string): boolean {
  return slug in MOVE_OUT_CONTENT;
}

export function getMoveOutTiers(
  slug: string = DEFAULT_UNIVERSITY.slug,
): MoveOutTier[] {
  return MOVE_OUT_CONTENT[slug] ?? MOVE_OUT_CONTENT[DEFAULT_UNIVERSITY.slug];
}
