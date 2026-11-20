import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * en ↔ zh key parity.
 *
 * WHY THIS EXISTS. `npm run i18n:verify` (src/test/i18nKeyResolution.test.ts) checks
 * that every key referenced in code resolves to non-empty ENGLISH copy — it reads
 * src/i18n/locales/en only. So a key added to en and forgotten in zh passed every
 * gate and shipped as English text leaking into a Chinese UI. IPP-3 required both
 * locales for its new error strings, which made the hole worth closing rather than
 * just stepping around.
 *
 * SHAPE: a ratchet, matching scripts/check-colors.mjs and friends. The 37 keys
 * already missing from zh when this landed are listed below as DEBT, by name, so
 * the list can only shrink — a new gap fails, and closing an old one is a one-line
 * deletion. Deliberately an inline list rather than a generated baseline file:
 * 37 is small enough to read, and a name you can see is a name someone will fix.
 */

const LOCALES = path.join(process.cwd(), 'src', 'i18n', 'locales');

/** Namespaces where zh parity is COMPLETE and must stay that way. */
const CLEAN_NAMESPACES = [
  'auth.json',
  'checklist.json',
  'common.json',
  'housing.json',
  'marketplace.json',
  'misc.json',
  'onboarding.json',
  'settings.json',
];

/**
 * Pre-existing gaps, untranslated when this test landed (2026-07-29). NOT from
 * IPP-3. Delete entries as translations land; never add.
 */
const KNOWN_MISSING_IN_ZH: Record<string, readonly string[]> = {
  'messaging.json': ['chat.confirmAsRoommate', 'chat.inviteToRoommateGroup'],
  // The roommate hub / presence / widget copy shipped en-only. 35 keys.
  'roommates.json': [
    'hub.checklistCardTitle',
    'hub.copyInviteLink',
    'hub.costsCardTitle',
    'hub.emptyState',
    'hub.emptyStateCta',
    'hub.inviteLinkCopied',
    'hub.inviteLinkCopyFailed',
    'hub.inviteLinkResetFailed',
    'hub.moveInCardTitle',
    'hub.officialMoveIn',
    'hub.openChecklist',
    'hub.openSplit',
    'hub.percentReady',
    'hub.picksCardTitle',
    'hub.picksDragHint',
    'hub.picksEmpty',
    'hub.picksSaveFailed',
    'hub.resetInviteLink',
    'hub.sharedSpend',
    'hub.sharedSpendEmpty',
    'hub.stillNeeded_one',
    'hub.stillNeeded_other',
    'hub.title',
    'hub.unknownDorm',
    'hub.yourArrival',
    'hub.yourArrivalNotSet',
    'presence.groupCaption',
    'presence.openHub',
    'presence.roommate',
    'presence.youAndN_one',
    'presence.youAndN_other',
    'presence.youAndOne',
    'widget.allSet',
    'widget.open',
    'widget.title',
  ],
};

function leafKeys(value: unknown, prefix = ''): string[] {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
    return Object.entries(value as Record<string, unknown>).flatMap(([k, v]) =>
      leafKeys(v, prefix ? `${prefix}.${k}` : k),
    );
  }
  return [prefix];
}

function keysFor(locale: string, ns: string): Set<string> {
  const raw = readFileSync(path.join(LOCALES, locale, ns), 'utf8');
  return new Set(leafKeys(JSON.parse(raw)));
}

describe('i18n en/zh parity', () => {
  const namespaces = readdirSync(path.join(LOCALES, 'en')).filter((f) => f.endsWith('.json'));

  it('ships the same namespace files in both locales', () => {
    expect(readdirSync(path.join(LOCALES, 'zh')).filter((f) => f.endsWith('.json')).sort()).toEqual(
      namespaces.slice().sort(),
    );
  });

  it.each(CLEAN_NAMESPACES)('%s has zero keys missing from zh', (ns) => {
    const missing = [...keysFor('en', ns)].filter((k) => !keysFor('zh', ns).has(k)).sort();
    expect(missing, `Add these to src/i18n/locales/zh/${ns}:\n  ${missing.join('\n  ')}`).toEqual(
      [],
    );
  });

  it('never grows the known-untranslated debt', () => {
    for (const [ns, known] of Object.entries(KNOWN_MISSING_IN_ZH)) {
      const zh = keysFor('zh', ns);
      const missing = [...keysFor('en', ns)].filter((k) => !zh.has(k));
      const unexpected = missing.filter((k) => !known.includes(k));
      expect(
        unexpected,
        `New untranslated key(s) in ${ns} — add the zh copy, don't extend the debt list:\n  ${unexpected.join('\n  ')}`,
      ).toEqual([]);
    }
  });

  it('covers every namespace between the clean set and the debt list', () => {
    // Guard against a NEW namespace file being added and silently unchecked.
    const accounted = new Set([...CLEAN_NAMESPACES, ...Object.keys(KNOWN_MISSING_IN_ZH)]);
    expect(namespaces.filter((ns) => !accounted.has(ns))).toEqual([]);
  });

  it('has zh copy for every IPP-3 form craft string', () => {
    // The keys this queue item introduced, asserted by name: the done criteria made
    // a missing zh key a failure rather than a follow-up.
    const required: Record<string, readonly string[]> = {
      'common.json': [
        'form.emailInvalid',
        'form.emailRequired',
        'form.messageRequired',
        'form.nameRequired',
      ],
      'auth.json': [
        'blocked.captcha',
        'blocked.confirmPassword',
        'blocked.email',
        'blocked.password',
        'blocked.schoolEmail',
      ],
      'marketplace.json': ['blocked.payment', 'blocked.photo', 'blocked.price', 'blocked.title'],
    };
    for (const [ns, keys] of Object.entries(required)) {
      const en = keysFor('en', ns);
      const zh = keysFor('zh', ns);
      for (const k of keys) {
        expect(en.has(k), `${ns} missing en ${k}`).toBe(true);
        expect(zh.has(k), `${ns} missing zh ${k}`).toBe(true);
      }
    }
  });
});
