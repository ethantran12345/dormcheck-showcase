import AxeBuilder from '@axe-core/playwright';
import { devices, expect, test } from '@playwright/test';
import { PITT_UNIVERSITY_ID, serviceClient } from '../lib/api';

/**
 * Regression (a11y, hard-fail in the weekly audit:app crawl): each /gallery card
 * was a div role="button" wrapping the Save, Edit and Delete buttons (axe
 * nested-interactive, serious → P0 under A11Y_STRICT=1). Opening a card must
 * still work by click and keyboard.
 */
test.use({ ...devices['Desktop Chrome'], viewport: { width: 1280, height: 720 } });

test.beforeAll(async () => {
  const svc = serviceClient();
  const { data: me } = await svc.from('profiles').select('id').ilike('email', process.env.E2E_USER_EMAIL!).single();
  // Fixture-labelled setup owned by the e2e student, so owner controls render too.
  const { error } = await svc.from('student_setups').upsert(
    [{ id: 990101, dorm_name: 'Litchfield Towers A', dorm_id: 990001, image_url: 'https://placehold.co/800x600/1F4D39/ffffff?text=Fixture', caption: 'Layout fixture setup', author_name: 'E2E Layout Fixture', user_id: me!.id, university_id: PITT_UNIVERSITY_ID }],
    { onConflict: 'id' },
  );
  if (error) throw error;
});

test('/gallery cards have no nested interactive controls, and still open', async ({ page }) => {
  test.skip((page.viewportSize()?.width ?? 0) < 1024, 'desktop card layout');
  await page.goto('/gallery');
  // Any setup card (the gallery is scoped to the student's building, so the
  // fixture above may not be the one shown; it guarantees owner controls exist
  // when it is).
  await page.locator('img[alt^="Room by"]').first().waitFor({ timeout: 15_000 });
  const open = page.getByRole('button', { name: /^Open room by / }).first();
  const { violations } = await new AxeBuilder({ page }).withRules(['nested-interactive']).analyze();
  expect(violations.flatMap((v) => v.nodes.map((n) => n.target.join(' ')))).toEqual([]);
  // Keyboard: the card's open control is focusable and Enter opens the detail.
  await open.focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
});
