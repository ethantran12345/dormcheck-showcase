export type SkipAdvisory = {
  /** Stable kebab-case slug */
  id: string;
  /** Display name */
  name: string;
  /** Short, plain-English; 1-2 sentences max */
  reason: string;
  /**
   * Pitt-prohibited item (banned from the residence halls) rather than soft
   * "you probably won't need it" advice. Banned advisories are surfaced first
   * and styled distinctly in the "Leave these at home" section.
   */
  banned?: boolean;
  /**
   * Optional. If present, this advisory becomes an INLINE BADGE on any
   * checklist item whose normalized name matches one of these strings
   * (case-insensitive, trimmed). If absent OR the array has no matches
   * in the user's checklist, this advisory shows in the appended
   * "Things to skip" section instead.
   */
  matchItemNames?: string[];
  /**
   * Optional allowed substitute. When present, the "Leave these at home"
   * card shows a one-tap "Add <alternative> instead" chip that adds the
   * substitute to the user's checklist.
   */
  alternative?: string;
};

export const SKIP_ADVISORIES: SkipAdvisory[] = [
  // - Banned at Pitt - items prohibited from the residence halls (arrival.pitt.edu).
  {
    id: 'extension-cords',
    name: 'Extension cords',
    reason: 'A fire hazard and not permitted. Use a surge-protector power strip instead.',
    banned: true,
    matchItemNames: ['extension cord', 'extension cords'],
    alternative: 'Surge protector power strip',
  },
  {
    id: 'cooking-appliances',
    name: 'Cooking appliances',
    reason:
      'Coffee makers with a burner, crockpots, water boilers, rice cookers / steamers, toasters & toaster ovens, air fryers, hot plates, and grills are all banned as fire hazards.',
    banned: true,
    matchItemNames: [
      'toaster',
      'toaster oven',
      'hot plate',
      'air fryer',
      'rice cooker',
      'crockpot',
      'coffee maker',
    ],
  },
  {
    id: 'air-conditioners',
    name: 'Air conditioners',
    reason: 'Not permitted in the residence halls. Bring a fan instead.',
    banned: true,
    matchItemNames: ['air conditioner', 'ac unit', 'window ac'],
    alternative: 'Fan',
  },
  {
    id: 'open-flame-decor',
    name: 'Candles & open-flame decor',
    reason:
      'Candles & warmers, lava lamps, halogen / quartz lamps, holiday lights, and space heaters are banned. Use battery-operated flameless candles instead.',
    banned: true,
    matchItemNames: ['candles', 'candle', 'lava lamp', 'space heater', 'holiday lights'],
    alternative: 'Flameless LED candles',
  },
  {
    id: 'pets',
    name: 'Pets',
    reason: 'Not permitted. Service and assistance animals need DRS approval first.',
    banned: true,
  },
  {
    id: 'e-scooters',
    name: 'E-scooters & hoverboards',
    reason: "Can't be stored, used, or charged in the buildings due to battery fire risk.",
    banned: true,
    matchItemNames: ['e-scooter', 'scooter', 'hoverboard'],
  },

  // - Skip - things you probably won't need (soft advice, not banned).
  {
    id: 'iron',
    name: 'Iron / Steamer',
    reason: 'Most students never iron. The laundry room usually has one if you ever need it.',
    matchItemNames: ['iron', 'iron / steamer', 'steamer', 'clothing iron'],
  },
  {
    id: 'printer',
    name: 'Personal printer',
    reason: 'Pitt has free printing across campus. A personal printer eats desk space and ink money.',
    matchItemNames: ['printer', 'personal printer'],
  },
  {
    id: 'tapestries',
    name: 'Bulky tapestries',
    reason: 'Often turn into clutter by November. Start minimal, and you can add later.',
    matchItemNames: ['tapestry', 'tapestries', 'wall tapestry'],
  },
  {
    id: 'mattress-topper',
    name: 'Mattress topper',
    reason:
      "Give your bed a few nights before buying one. Cheap foam toppers are one of the most common move-out throwaways and can't be recycled.",
    matchItemNames: ['mattress topper', 'mattress topper (4" foam)', 'foam mattress topper'],
  },

  {
    id: 'cheap-vacuum',
    name: 'Cheap vacuum',
    reason: 'Most budget vacuums (under $40) lose suction within a semester. Many dorms have communal vacuums you can borrow.',
  },
  {
    id: 'oversized-fridge',
    name: 'Mini-fridge over 4 cu ft',
    reason: 'Most Pitt dorms cap fridge size around 4 cu ft. Check your housing agreement before buying.',
  },
  {
    id: 'desk-lamp',
    name: 'Full-size desk lamp',
    reason: 'Built-in dorm lighting is usually enough. A clip-on light for your bed is more useful.',
  },
  {
    id: 'too-many-hangers',
    name: 'Too many hangers',
    reason: 'Closets are smaller than you expect. Start with 20, and you can always buy more.',
  },
  {
    id: 'bulky-storage-bins',
    name: 'Bulky storage bins',
    reason: 'Hard to fit under beds. Soft fabric cubes or collapsible bins work better.',
  },
  {
    id: 'second-monitor',
    name: 'Second monitor (freshman year)',
    reason: 'Sounds great until you see the desk is 36 inches wide. Wait until move-in to decide.',
  },
  {
    id: 'full-bedding-set',
    name: 'Multi-piece bedding sets',
    reason: "You'll use the comforter and one set of sheets. The rest just takes up storage.",
  },
  {
    id: 'expensive-decor',
    name: 'Expensive wall decor',
    reason: 'Damage policies are strict and command strips fail. Save the splurge for sophomore year housing.',
  },
  {
    id: 'shoes',
    name: 'Your entire shoe collection',
    reason: "Bring 4-5 pairs you actually wear. There's no place to put 20.",
  },
];
