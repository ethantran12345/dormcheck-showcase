/**
 * First-pass prohibited-content screen for marketplace posts.
 *
 * This is a blunt keyword match - the real enforcement is the matching DB
 * trigger (`reject_prohibited_listing`, see the marketplace-moderation
 * migration) plus user reports + admin review. Keeping a client-side copy gives
 * the poster an instant, friendly "you can't list this" instead of a raw DB
 * error.
 *
 * Patterns are intentionally NARROW and word-boundaried so legitimate dorm items
 * (a kitchen knife, "weed killer", a nerf gun) don't get falsely blocked. Tune
 * `PROHIBITED_RULES` for the community - and keep it in sync with the SQL trigger.
 */

export interface ProhibitedCheck {
  blocked: boolean;
  /** Short, user-facing category of what matched (e.g. "weapons"). */
  category?: string;
}

const PROHIBITED_RULES: { category: string; pattern: RegExp }[] = [
  {
    category: 'weapons',
    pattern:
      /\b(guns?|firearms?|pistols?|handguns?|rifles?|shotguns?|ammo|ammunition|silencers?)\b/i,
  },
  {
    category: 'drugs',
    pattern:
      /\b(cocaine|heroin|meth|methamphetamine|fentanyl|lsd|mdma|ecstasy|ketamine|shrooms|psilocybin|adderall|xanax|percocet|oxycodone|oxycontin)\b/i,
  },
  {
    // Cannabis terms only flag when paired with a sale signal, to avoid blocking
    // e.g. "weed killer" or a band tee that says "cannabis".
    category: 'drugs',
    pattern: /\b(weed|marijuana|cannabis|carts?|dabs?|edibles?)\b[\s\S]{0,30}\b(sale|sell|selling|oz|grams?|\$)\b/i,
  },
  {
    category: 'adult content',
    pattern: /\b(escorts?|nudes|onlyfans)\b/i,
  },
];

/** Returns whether the combined listing text trips a prohibited-content rule. */
export function checkProhibitedContent(text: string): ProhibitedCheck {
  const t = (text ?? '').trim();
  if (!t) return { blocked: false };
  for (const rule of PROHIBITED_RULES) {
    if (rule.pattern.test(t)) return { blocked: true, category: rule.category };
  }
  return { blocked: false };
}
