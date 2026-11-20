import { expect, test } from '@playwright/test';

test.describe.configure({ timeout: 60_000 });
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serviceClient } from '../lib/api';

/**
 * Regression (contract §7, P0 journey "marketplace create per post type"): when
 * the address lookup fails (provider down / rejected, here the e2e dummy Mapbox
 * token → 401 and Census CORS), Post must end in a visible, specific error the
 * student can act on, not a click that appears to do nothing, and must not
 * write a row.
 */
const HERE = path.dirname(fileURLToPath(import.meta.url));

test('sublease Post with an unresolvable address shows a clear error and posts nothing', async ({ page }) => {
  await postWithAddress(page);
});

test('a geocoder that never answers still ends in the same error (no endless "posting")', async ({ page }) => {
  // Provider hangs (no response at all): the post must give up and say so.
  await page.route(/api\.mapbox\.com|geocoding\.geo\.census\.gov/, () => new Promise(() => {}));
  await postWithAddress(page, 25_000);
});

async function postWithAddress(page: import('@playwright/test').Page, errorWithin = 15_000) {
  const { data: me } = await serviceClient().from('profiles').select('id').ilike('email', process.env.E2E_USER_EMAIL!).single();
  await serviceClient().from('profiles').update({ current_dorm: 'Litchfield Towers A' }).eq('id', me!.id);
  const address = `Geocode failure fixture ${Date.now().toString(36)}, Pittsburgh, PA`;

  await page.goto('/subleases/create');
  await page.locator('#mp-sublease-address').fill(address);
  // Tab, not Escape: on phones the composer is a sheet and Escape closes it.
  await page.keyboard.press('Tab');
  await page.locator('#mp-sublease-start').fill('2027-01-05');
  await page.locator('#mp-sublease-end').fill('2027-05-01');
  await page.locator('#mp-listing-price').fill('700');
  // The picker input is created on demand (handlePickPhotos), as in
  // marketplace.lifecycle.spec.ts: click and catch the file chooser.
  const [chooser] = await Promise.all([
    page.waitForEvent('filechooser'),
    page.getByRole('button', { name: 'Add listing photos' }).first().click(),
  ]);
  await chooser.setFiles(path.join(HERE, '../fixtures/listing.png'));
  const post = page.getByRole('button', { name: 'Post', exact: true });
  await expect(post).toBeEnabled({ timeout: 10_000 });
  await post.click();

  // The student must be told, persistently enough to read: an inline error on
  // the address field (not only a transient toast).
  await expect(page.locator('#mp-sublease-address')).toHaveAttribute('aria-invalid', 'true', { timeout: errorWithin });
  await expect(page.getByText(/couldn.t find|could not find|check the address|address/i).filter({ visible: true }).first()).toBeVisible();
  await expect(post).toBeEnabled(); // not stuck in a posting state
  const { count } = await serviceClient().from('marketplace_listings').select('id', { count: 'exact', head: true }).ilike('title', `${address.split(',')[0]}%`);
  expect(count).toBe(0);
}
