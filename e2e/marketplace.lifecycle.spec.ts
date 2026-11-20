import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceClient, PITT_UNIVERSITY_ID } from './lib/api';
import { acknowledgeLegalNotice } from './lib/ui';

/**
 * Marketplace lifecycle — the seller's whole journey through the real UI:
 * create → (moderation state) → edit → sold/relist → expired/relist → delete,
 * plus the business-listing create path. Runs as the seeded Phase-1 student
 * (user project storageState). Server-side refusal coverage lives in
 * marketplace.security.spec.ts; this file is about the UI honoring lifecycle
 * state, so DB fixtures are set up via the service client where the state
 * can't be reached through the UI (e.g. expiry, which is time-based).
 *
 * Context hygiene: each test is a fresh browser context (Playwright default)
 * and stays well under ~10 navigations — long shared sessions are a known
 * degradation/hang failure mode in this repo.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));

const USER_EMAIL = process.env.E2E_USER_EMAIL!;

let userId: string;

test.beforeAll(async () => {
  // The seeded user already exists (auth.setup signed it in); resolve its id
  // without touching GoTrue's listUsers (see e2e/lib/api.ts).
  const { data, error } = await serviceClient()
    .from('profiles')
    .select('id')
    .ilike('email', USER_EMAIL)
    .single();
  if (error) throw error;
  userId = data.id;
  // Every test in this file clicks a control inside a My Items card, and the
  // legal-update banner is a fixed, click-swallowing layer over the bottom of
  // exactly that screen. Clear it for this persona before any of them run.
  await acknowledgeLegalNotice(userId);
});

/** Service-role fixture listing in a given status; cleaned up per test. */
async function fixtureListing(title: string, status: string) {
  const { data, error } = await serviceClient()
    .from('marketplace_listings')
    .insert({
      user_id: userId,
      university_id: PITT_UNIVERSITY_ID,
      title,
      price: 20,
      category: 'Appliances',
      status,
      // The edit form's canSubmit needs a photo and a payment method, same as
      // create — a bare row would leave Save permanently disabled.
      image_urls: ['/placeholder.svg'],
      payment_methods: ['cash'], // CHECK allows lowercase zelle|venmo|cash
    })
    .select('id')
    .single();
  if (error) throw new Error(`fixture failed: ${error.message}`);
  return data.id as string;
}

async function removeListing(id: string) {
  await serviceClient().from('marketplace_listings').delete().eq('id', id);
}

/** The My Items card root (bg-card container) for a given listing title. */
function cardFor(page: Page, title: string) {
  return page.locator('div[class*="bg-card"]', { hasText: title }).first();
}

test.describe('student listing lifecycle (UI)', () => {
  test('create through the composer lands in My Items in a moderation-aware state', async ({ page }) => {
    const title = `E2E lifecycle create ${Date.now()}`;

    await page.goto('/marketplace/create');
    await expect(page.getByRole('heading', { name: 'Post an Item' })).toBeVisible({ timeout: 15_000 });

    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.getByRole('button', { name: 'Add listing photos' }).click(),
    ]);
    await chooser.setFiles(path.join(HERE, 'fixtures', 'listing.png'));

    await page.getByPlaceholder('e.g., Mini Fridge').fill(title);
    await page.getByPlaceholder('0').first().fill('42');
    await page.getByRole('button', { name: 'Cash' }).click();

    // Post enables only once the photo upload has really finished — waiting on
    // enabled-ness here is the web-first way to cover the async upload.
    const post = page.getByRole('button', { name: /^Post$/ });
    await expect(post).toBeEnabled({ timeout: 20_000 });
    await post.click();
    await expect(page).toHaveURL(/\/marketplace\?tab=buy-sell/, { timeout: 15_000 });

    await page.goto('/marketplace/my-items');
    const card = cardFor(page, title);
    await expect(card).toBeVisible({ timeout: 15_000 });
    // Pre-moderation means the fresh listing must carry SOME lifecycle badge —
    // "In review" while the pipeline holds it, or "Active" once approved.
    await expect(card.getByText(/In review|Active/).first()).toBeVisible();

    // Cleanup so repeat runs don't accumulate cards.
    await serviceClient().from('marketplace_listings').delete().eq('title', title);
  });

  test('edit an existing listing and see the change in My Items', async ({ page }) => {
    const title = `E2E lifecycle edit ${Date.now()}`;
    const id = await fixtureListing(title, 'available');
    try {
      await page.goto(`/marketplace/edit/${id}`);
      // Controlled inputs carry their value as a DOM property, never as an
      // attribute — assert via toHaveValue, not a [value=…] selector.
      const titleInput = page.getByRole('textbox', { name: 'Title' });
      await expect(titleInput).toHaveValue(title, { timeout: 15_000 });
      await titleInput.fill(`${title} EDITED`);
      await page.getByRole('button', { name: /^save( changes)?$/i }).click();

      await page.goto('/marketplace/my-items');
      await expect(page.getByText(`${title} EDITED`).first()).toBeVisible({ timeout: 15_000 });
      void titleInput;
    } finally {
      await removeListing(id);
    }
  });

  test('mark sold, then bring it back to available', async ({ page }) => {
    const title = `E2E lifecycle sold ${Date.now()}`;
    const id = await fixtureListing(title, 'available');
    try {
      await page.goto('/marketplace/my-items');
      const card = cardFor(page, title);
      await expect(card).toBeVisible({ timeout: 15_000 });

      await card.getByRole('button', { name: 'Mark as Sold' }).click();
      await expect(card.getByText('Sold').first()).toBeVisible({ timeout: 10_000 });

      // A sold listing's way back to the feed is Relist.
      await card.getByRole('button', { name: 'Relist' }).click();
      await expect(card.getByText('Active').first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await removeListing(id);
    }
  });

  test('an expired listing shows its state and can be relisted', async ({ page }) => {
    const title = `E2E lifecycle expired ${Date.now()}`;
    const id = await fixtureListing(title, 'expired');
    try {
      await page.goto('/marketplace/my-items');
      const card = cardFor(page, title);
      await expect(card).toBeVisible({ timeout: 15_000 });
      await expect(card.getByText('Expired').first()).toBeVisible();

      await card.getByRole('button', { name: 'Relist' }).click();
      await expect(card.getByText('Active').first()).toBeVisible({ timeout: 10_000 });
    } finally {
      await removeListing(id);
    }
  });

  test('delete asks for confirmation and actually removes the listing', async ({ page }) => {
    const title = `E2E lifecycle delete ${Date.now()}`;
    const id = await fixtureListing(title, 'available');
    let removed = false;
    try {
      await page.goto('/marketplace/my-items');
      const card = cardFor(page, title);
      await expect(card).toBeVisible({ timeout: 15_000 });

      await card.getByRole('button', { name: 'Delete listing' }).click();
      await expect(page.getByRole('alertdialog')).toContainText('Delete listing?');
      await page.getByRole('button', { name: /^Delete$/ }).click();

      await expect(page.getByText(title)).toHaveCount(0, { timeout: 15_000 });

      // The UI said it's gone — verify the row is really gone, not just hidden.
      const { data } = await serviceClient()
        .from('marketplace_listings')
        .select('id')
        .eq('id', id);
      expect(data).toHaveLength(0);
      removed = true;
    } finally {
      if (!removed) await removeListing(id);
    }
  });
});

test.describe('business listing lifecycle (UI)', () => {
  // SHOW_STUDENT_BUSINESSES is false (src/lib/featureFlags.ts), so the whole
  // business-listing UI — the My Businesses tab and its create form — is
  // intentionally unreachable for students today. The business ACTOR is still
  // covered where it matters: marketplace.security.spec.ts drives the full
  // create → self-approve-refused → approve → tenant-scoped-visibility
  // lifecycle at the API layer. When the flag flips on, replace this
  // gate-assertion with the real UI create test (form strings are already in
  // marketplace:business.form.*).
  test('the businesses tab stays unreachable while the feature flag is off', async ({ page }) => {
    await page.goto('/marketplace/my-items?tab=businesses');
    // The page must fall back to the items tab, not render the business CTA.
    await expect(page.getByRole('heading', { name: 'My Marketplace' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByRole('button', { name: 'List Your Business' })).toHaveCount(0);
  });
});
