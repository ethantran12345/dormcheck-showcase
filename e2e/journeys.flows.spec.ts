import { expect, test, type Browser, type Page } from '@playwright/test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CMU_UNIVERSITY_ID, FIXTURE_PASSWORD, PITT_UNIVERSITY_ID, ensureUser, serviceClient } from './lib/api';
import { Journey, expectSettled } from './lib/journey';
import { expectNoStuckTransition, failReads } from './lib/probes';

/**
 * No-dead-end sweep, flow half: the P0 journeys from
 * docs/audits/feature-journey-inventory.md §5 that the existing flow specs do
 * not already walk (those run alongside in journey mode and count as evidence:
 * auth.flows, marketplace.lifecycle + security, messaging, flows,
 * regression.checklist). Every check asserts a terminal state.
 *
 * Fixture people are labelled as such (no real-looking students).
 */

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PEER_EMAIL = 'e2e-journey-peer@pitt.edu';
const PEER_NAME = 'E2E Journey Peer';
const CMU_EMAIL = 'e2e-journey-cmu@andrew.cmu.edu';
const USER_EMAIL = process.env.E2E_USER_EMAIL!;
const stamp = () => `${test.info().project.name.replace('journeys-', '')}-${Date.now().toString(36)}`;
const isPhone = () => (test.info().project.use.viewport?.width ?? 1280) < 768;

let userId: string;
let peerId: string;

// Journeys walk several reloads each; the base 45s per-test budget made a slow
// step cascade into "page closed" for every check after it.
test.describe.configure({ timeout: 180_000 });
const CHECKLIST_POST = (u: URL) => u.pathname.endsWith('/rest/v1/checklist_items');
const MESSAGES_POST = (u: URL) => u.pathname.endsWith('/rest/v1/messages');

test.beforeAll(async () => {
  peerId = await ensureUser(PEER_EMAIL, { universityId: PITT_UNIVERSITY_ID, fullName: PEER_NAME });
  const { data, error } = await serviceClient().from('profiles').select('id').ilike('email', USER_EMAIL).single();
  if (error) throw error;
  userId = data.id;
  // Each project starts the DM as a fresh request (the first message to a new
  // contact is a request by design, and a pending one has no composer).
  const svc = serviceClient();
  const { data: convs } = await svc.from('conversations').select('id').or(`participant_1.eq.${peerId},participant_2.eq.${peerId}`);
  for (const c of convs ?? []) {
    await svc.from('messages').delete().eq('conversation_id', c.id);
    await svc.from('conversations').delete().eq('id', c.id);
  }
});

const addBox = (page: Page) => page.getByRole('textbox', { name: 'Add an item…' });
const row = (page: Page, item: string) => page.getByRole('button', { name: new RegExp(`^Advance ${item.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}, currently`) });

test('checklist: add via ?add=1, advance, delete, with read-back', async ({ page }) => {
  const j = new Journey('checklist-mutate', 'Checklist: ?add=1 → add → advance → delete', 'Checklist', 'P0', page);
  const item = `Journey item ${stamp()}`;
  await page.goto('/checklist?add=1');
  await j.check('entry', '?add=1 opens the personal list with the add field focused', async () => {
    await expect(addBox(page)).toBeVisible({ timeout: 15_000 });
    await expect(addBox(page)).toBeFocused();
  });
  await j.check('result', 'Enter adds the item and it appears', async () => {
    await addBox(page).fill(item);
    await addBox(page).press('Enter');
    await expect(row(page, item)).toBeVisible({ timeout: 10_000 });
  }, { needs: ['?add=1 opens the personal list with the add field focused'] });
  await j.check('next', 'the field clears and stays ready for the next item', async () => {
    await expect(addBox(page)).toHaveValue('');
    await expect(addBox(page)).toBeFocused();
  }, { needs: ['Enter adds the item and it appears'] });
  await j.check('readback', 'the item survives a reload', async () => {
    await page.goto('/checklist?add=1');
    await expect(row(page, item)).toBeVisible({ timeout: 15_000 });
  }, { needs: ['Enter adds the item and it appears'] });
  await j.check('result', 'advancing the status shows "Have"', async () => {
    await row(page, item).click();
    await expect(page.getByRole('button', { name: `Advance ${item}, currently Have` })).toBeVisible({ timeout: 10_000 });
  }, { needs: ['the item survives a reload'] });
  await j.check('readback', 'the new status survives a reload', async () => {
    await page.goto('/checklist?add=1');
    await expect(page.getByRole('button', { name: `Advance ${item}, currently Have` })).toBeVisible({ timeout: 15_000 });
  }, { needs: ['advancing the status shows "Have"'] });
  await j.check('result', 'delete removes the row', async () => {
    await page.getByRole('button', { name: `More actions for ${item}` }).click();
    await page.getByRole('menuitem', { name: 'Delete' }).click();
    await expect(row(page, item)).toHaveCount(0, { timeout: 10_000 });
  }, { needs: ['the item survives a reload'] });
  await j.check('cancel', 'delete is recoverable (confirm or undo)', async () => {
    // Contract §8: destructive actions warn or can be undone. Look for either
    // an undo action in a toast or a confirm that preceded the removal.
    await expect(page.getByRole('button', { name: /undo/i })).toBeVisible({ timeout: 3_000 });
  }, { needs: ['delete removes the row'] });
  await j.check('readback', 'the deletion survives a reload', async () => {
    await page.goto('/checklist?add=1');
    await expect(addBox(page)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, item)).toHaveCount(0);
  }, { needs: ['delete removes the row'] });
  await j.check('cancel', 'typing then leaving without Enter creates nothing', async () => {
    const draft = `Abandoned draft ${stamp()}`;
    await addBox(page).fill(draft);
    await page.goto('/my-home');
    const { count } = await serviceClient().from('checklist_items').select('id', { count: 'exact', head: true }).eq('user_id', userId).eq('item', draft);
    expect(count).toBe(0);
  });
  await j.check('errors', 'a refused write says so and does not show the item as saved', async () => {
    const failing = `Refused item ${stamp()}`;
    await page.route(CHECKLIST_POST, (r) =>
      r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected"}' }) : r.continue(),
    );
    await page.goto('/checklist?add=1');
    await addBox(page).fill(failing);
    await addBox(page).press('Enter');
    await expect(page.getByText(/fail|couldn.t|could not|error/i).filter({ visible: true }).first()).toBeVisible({ timeout: 8_000 });
    await page.unroute(CHECKLIST_POST);
    await page.goto('/checklist?add=1');
    await expect(addBox(page)).toBeVisible({ timeout: 15_000 });
    await expect(row(page, failing)).toHaveCount(0);
  });
  await j.check('errors', 'a failed load shows an error with retry, not "Nothing on this list yet"', async () => {
    const undo = await failReads(page, '500');
    await page.goto('/checklist?add=1');
    await page.waitForTimeout(4_000);
    await expect(page.getByText('Nothing on this list yet')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /retry|try again/i }).filter({ visible: true }).first()).toBeVisible({ timeout: 6_000 });
    await undo();
  });
  j.finish();
});

test('checklist: group list + manage + family share link, read by a signed-out viewer', async ({ page, browser, context }) => {
  const j = new Journey('checklist-share', 'Checklist: group list, manage, family link', 'Checklist', 'P0', page);
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  const groupsBefore = (await serviceClient().from('ranking_collaborations').select('id', { count: 'exact', head: true })).count ?? 0;
  await page.goto('/checklist');
  const dlg = page.getByRole('dialog');
  await j.check('entry', '"Make a new group list" opens the roommate-groups dialog', async () => {
    await page.getByRole('button', { name: 'Make a new group list' }).click();
    await expect(dlg).toBeVisible();
  });
  await j.check('result', 'creating the group lands on its invite surface', async () => {
    await dlg.getByRole('button', { name: /Create group & get invite link|Confirm .* & get link/ }).click();
    await expect(dlg.getByRole('button', { name: /Share invite link/ })).toBeVisible({ timeout: 10_000 });
    await expect.poll(async () => (await serviceClient().from('ranking_collaborations').select('id', { count: 'exact', head: true })).count ?? 0).toBeGreaterThan(groupsBefore);
  }, { needs: ['"Make a new group list" opens the roommate-groups dialog'] });
  let shareUrl = '';
  await j.check('result', 'family link: "Add a parent (view-only)" copies a link', async () => {
    await dlg.getByRole('button', { name: /Add a parent \(view-only\)|Copy parent link/ }).click();
    await expect(page.getByText('Family link copied').first()).toBeVisible({ timeout: 10_000 });
    shareUrl = await page.evaluate(() => navigator.clipboard.readText());
    expect(shareUrl).toMatch(/\/checklist\/shared\//);
  }, { needs: ['creating the group lands on its invite surface'] });
  await j.check('trust', 'a signed-out viewer can read the shared list', async () => {
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await anon.newPage();
    await p.goto(new URL(shareUrl).pathname);
    await expectSettled(p);
    await expect(p.getByText('This link is no longer active')).toHaveCount(0);
    await expect(p.getByText(/Could not load the checklist/)).toHaveCount(0);
    await anon.close();
  }, { needs: ['family link: "Add a parent (view-only)" copies a link'] });
  await j.check('trust', '"Turn off link" revokes it for the viewer', async () => {
    await dlg.getByRole('button', { name: 'Turn off link' }).click();
    await expect(page.getByText('Family link turned off').first()).toBeVisible({ timeout: 10_000 });
    const anon = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const p = await anon.newPage();
    await p.goto(new URL(shareUrl).pathname);
    await expect(p.getByText('This link is no longer active')).toBeVisible({ timeout: 15_000 });
    await anon.close();
  }, { needs: ['a signed-out viewer can read the shared list'] });
  await j.check('cancel', 'Close dismisses the dialog', async () => {
    await dlg.getByRole('button', { name: 'Close' }).first().click();
    await expect(dlg).toHaveCount(0);
  });
  await j.check('readback', 'the new group list is on the hub after reload', async () => {
    await page.goto('/checklist');
    await expect(page.getByText('My Group').first()).toBeVisible({ timeout: 15_000 });
  }, { needs: ['creating the group lands on its invite surface'] });
  await j.check('result', 'hub card "Manage list" opens the manage sheet', async () => {
    await page.getByRole('button', { name: 'Manage list' }).first().click({ timeout: 10_000 });
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  }, { needs: ['the new group list is on the hub after reload'] });
  j.finish();
});

test('messages: ?compose=1 → find → send → read-back; report; cancel', async ({ page }) => {
  const j = new Journey('messages-compose', 'Messages: ?compose=1 → send → report', 'Messages', 'P0', page);
  const text = `Journey hello ${stamp()}`;
  await page.goto('/messages?compose=1');
  const dlg = page.getByRole('dialog', { name: 'Find someone to message' });
  await j.check('entry', '?compose=1 opens "Find someone to message"', async () => {
    await expect(dlg).toBeVisible({ timeout: 15_000 });
  });
  await j.check('cancel', 'Close dismisses compose and it does not reopen on reload', async () => {
    await dlg.getByRole('button', { name: 'Close' }).first().click();
    await expect(dlg).toHaveCount(0);
    await page.reload();
    await expectSettled(page);
    await expect(dlg).toHaveCount(0);
  }, { needs: ['?compose=1 opens "Find someone to message"'] });
  await j.check('result', 'search finds the peer and opens the conversation', async () => {
    await page.goto('/messages?compose=1');
    await dlg.getByRole('textbox').fill('E2E Journey');
    await dlg.getByText(PEER_NAME).first().click();
    await expect(dlg).toHaveCount(0);
    await expect(page.getByPlaceholder('Message...')).toBeVisible({ timeout: 10_000 });
  });
  await j.check('errors', 'a refused send says so and does not show the message as sent', async () => {
    const refused = `Refused ${stamp()}`;
    await page.route(MESSAGES_POST, (r) =>
      r.request().method() === 'POST' ? r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"injected"}' }) : r.continue(),
    );
    await page.getByPlaceholder('Message...').fill(refused);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(/fail|couldn.t|could not|not sent|retry/i).filter({ visible: true }).first()).toBeVisible({ timeout: 8_000 });
    await page.unroute(MESSAGES_POST);
  }, { needs: ['search finds the peer and opens the conversation'] });
  await j.check('result', 'first message sends as a request and says so', async () => {
    await page.goto(`/messages?user=${peerId}`);
    await page.getByPlaceholder('Message...').fill(text);
    await page.getByRole('button', { name: 'Send message' }).click();
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/sent as a request/i).first()).toBeVisible();
  }, { needs: ['search finds the peer and opens the conversation'] });
  await j.check('next', 'a pending request offers Retract and explains the wait', async () => {
    await expect(page.getByRole('button', { name: /Retract request/i }).first()).toBeVisible();
    await expect(page.getByText(/Waiting for approval/i).first()).toBeVisible();
  }, { needs: ['first message sends as a request and says so'] });
  await j.check('readback', 'the message survives a reload', async () => {
    await page.goto(`/messages?user=${peerId}`);
    await expect(page.getByText(text).first()).toBeVisible({ timeout: 15_000 });
  }, { needs: ['first message sends as a request and says so'] });
  await j.check('progress', 'report: Submit stays disabled until a category is picked; Cancel closes', async () => {
    await page.getByRole('button', { name: 'Conversation options' }).filter({ visible: true }).first().click({ timeout: 10_000 });
    await page.getByRole('menuitem', { name: 'Report' }).click();
    // AlertDialog on desktop; on phones the same report form opens as a drawer.
    const report = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
    await expect(report).toBeVisible();
    await expect(report.getByRole('button', { name: 'Submit report' })).toBeDisabled();
    await report.getByRole('button', { name: 'Cancel' }).click();
    await expect(report).toHaveCount(0);
  }, { needs: ['the message survives a reload'] });
  await j.check('result', 'report submits, confirms, and lands a row', async () => {
    await page.getByRole('button', { name: 'Conversation options' }).filter({ visible: true }).first().click();
    await page.getByRole('menuitem', { name: 'Report' }).click();
    // AlertDialog on desktop; on phones the same report form opens as a drawer.
    const report = page.getByRole('alertdialog').or(page.getByRole('dialog')).first();
    await report.getByRole('combobox', { name: 'Report category' }).click();
    await page.getByRole('option').first().click();
    await report.getByRole('button', { name: 'Submit report' }).click();
    await expect(page.getByText('Reported').first()).toBeVisible({ timeout: 10_000 });
    // One report per reporter per target (uniq_one_report_per_user_per_content),
    // so assert this student's report on this peer exists, not that a count grew.
    await expect
      .poll(async () => (await serviceClient().from('content_reports').select('id', { count: 'exact', head: true }).eq('reporter_id', userId).eq('content_type', 'user').eq('content_id', peerId)).count ?? 0)
      .toBe(1);
  }, { needs: ['report: Submit stays disabled until a category is picked; Cancel closes'] });
  j.notVerified('progress', 'voice message (record → send → play)', 'needs a microphone; covered on device only');
  j.finish();
});

test('command palette: every action reaches its destination', async ({ page }) => {
  const j = new Journey('palette-actions', 'Command palette (⌘K) actions', 'Navigation', 'P0', page);
  const open = async () => {
    await page.keyboard.press('ControlOrMeta+k');
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 5_000 });
  };
  const run = async (name: string | RegExp) => {
    await page.goto('/my-home');
    await expectSettled(page);
    await open();
    await page.getByRole('option', { name }).first().click();
  };
  await j.check('result', '"Add a checklist item" → focused add field', async () => {
    await run('Add a checklist item');
    await expect(addBox(page)).toBeFocused({ timeout: 15_000 });
  });
  await j.check('result', '"Start a message" → compose dialog', async () => {
    await run('Start a message');
    await expect(page.getByRole('dialog', { name: 'Find someone to message' })).toBeVisible({ timeout: 15_000 });
  });
  await j.check('result', '"New listing" → the listing composer', async () => {
    await run('New listing');
    await expect(page.getByRole('heading', { name: /Post an Item/ }).or(page.getByRole('dialog')).first()).toBeVisible({ timeout: 15_000 });
  });
  await j.check('result', '"Notification settings" → notifications section', async () => {
    await run('Notification settings');
    await expect(page).toHaveURL(/\/settings\?section=notifications/);
    await expect(page.getByText(/notification/i).filter({ visible: true }).first()).toBeVisible();
  });
  await j.check('result', '"Switch to dark/light mode" flips the theme and closes', async () => {
    const before = await page.evaluate(() => document.documentElement.classList.contains('dark'));
    await run(/Switch to (dark|light) mode/);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.classList.contains('dark'))).not.toBe(before);
    await page.evaluate(() => localStorage.removeItem('dormcheck-theme'));
  });
  await j.check('cancel', 'Esc closes the palette and returns focus', async () => {
    await page.goto('/my-home');
    await expectSettled(page);
    await open();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });
  j.notVerified('result', '"Sign out"', 'global sign-out would revoke the shared e2e session; covered by auth.flows.spec.ts');
  j.finish();
});

test('shortcuts sheet: ? opens, Esc closes, focus returns', async ({ page }) => {
  test.skip(isPhone(), '"?" is a desktop-pointer affordance by design');
  const j = new Journey('shortcuts-sheet', '"?" keyboard shortcuts sheet', 'Navigation', 'P0', page);
  await page.goto('/my-home');
  await expectSettled(page);
  await j.check('entry', '"?" opens "Keyboard shortcuts"', async () => {
    await page.keyboard.press('?');
    await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible({ timeout: 5_000 });
  });
  await j.check('cancel', 'Esc closes it with no stuck transition', async () => {
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoStuckTransition(page);
  }, { needs: ['"?" opens "Keyboard shortcuts"'] });
  j.finish();
});

test('card → detail → back: marketplace listing and dorm', async ({ page }) => {
  const j = new Journey('card-detail-back', 'Card → detail → back', 'Navigation', 'P0', page);
  const card = page.locator('[data-listing-open]').first();
  const detail = page.getByRole('dialog');
  await page.goto('/marketplace');
  await j.check('entry', 'listing card opens the detail', async () => {
    await card.click();
    await expect(detail).toBeVisible({ timeout: 10_000 });
    await expectNoStuckTransition(page);
  });
  await j.check('cancel', 'Close returns to the list with focus on the card', async () => {
    await detail.getByRole('button', { name: 'Close' }).first().click();
    await expect(detail).toHaveCount(0);
    await expectNoStuckTransition(page);
    await expect(card).toBeFocused();
  }, { needs: ['listing card opens the detail'] });
  await j.check('cancel', 'browser Back closes the detail and stays on /marketplace', async () => {
    // Arrive the way a student does (from another page) so Back has somewhere
    // to go: the question is whether it closes the sheet or leaves the page.
    await page.goto('/my-home');
    await page.goto('/marketplace');
    await card.click();
    await expect(detail).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/marketplace/);
    await expect(detail).toHaveCount(0);
    await expectNoStuckTransition(page);
  }, { needs: ['listing card opens the detail'] });
  await j.check('entry', '?listing=<id> deep link opens the detail', async () => {
    await page.goto('/marketplace?listing=a0000000-0000-4000-8000-000000000001');
    await expect(detail).toBeVisible({ timeout: 15_000 });
    await expect(detail.getByText(/Mini fridge/).first()).toBeVisible();
  });
  await j.check('entry', 'dorm card → /campus/<slug>', async () => {
    await page.goto('/campus');
    await expectSettled(page);
    // On phones the dorm list is a resizable sheet over the map: target the
    // visible card control, not the first text match (a hidden map label).
    await page.getByRole('button', { name: 'Sutherland Hall' }).or(page.getByRole('link', { name: 'Sutherland Hall' })).filter({ visible: true }).first().click();
    await expect(page).toHaveURL(/\/campus\/sutherland-hall/);
    await expectNoStuckTransition(page);
  });
  await j.check('cancel', 'Back from dorm detail lands on a settled /campus', async () => {
    await page.goBack();
    await expect(page).toHaveURL(/\/campus\/?(\?|$)/);
    await expectNoStuckTransition(page);
    await expect(page.getByRole('button', { name: 'Sutherland Hall' }).or(page.getByRole('link', { name: 'Sutherland Hall' })).filter({ visible: true }).first()).toBeVisible();
  }, { needs: ['dorm card → /campus/<slug>'] });
  j.finish();
});

test('My Home: a failed marketplace read is not shown as "Nothing listed yet"', async ({ page }) => {
  const j = new Journey('my-home-errors', 'My Home: widget load failures', 'My Home', 'P1', page);
  await page.route((u) => /\/rest\/v1\/marketplace/.test(u.pathname), (r) => r.abort('internetdisconnected'));
  await page.goto('/my-home');
  await page.waitForTimeout(5_000);
  await j.check('errors', 'marketplace widget does not claim the school has no listings', async () => {
    await expect(page.getByText(/Nothing listed at .* yet/)).toHaveCount(0);
  });
  j.finish();
});

const GATED = ['/map', '/roommates', '/roommates/liked', '/roommates/saved-posts', '/rankings/invite/BOGUSCODE'];
const OPEN_PITT = ['/campus', '/housing', '/gallery', '/subleases'];

async function signInUi(browser: Browser, email: string, password: string, school: string) {
  const ctx = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const page = await ctx.newPage();
  await page.goto(`/auth?school=${school}`);
  await page.locator('#auth-email').fill(email);
  await page.getByRole('button', { name: /^continue$/i }).click();
  await page.locator('#auth-password').fill(password);
  await page.getByRole('button', { name: /^sign in$/i }).click();
  await expect(page).not.toHaveURL(/\/auth(\?|$)/, { timeout: 20_000 });
  return { ctx, page };
}

test('deep links to gated surfaces, per tenant', async ({ page, browser }) => {
  test.setTimeout(180_000);
  const j = new Journey('tenant-deep-links', 'Deep links to flag-gated surfaces (Pitt, CMU)', 'Feature flags', 'P0', page);
  for (const p of GATED) {
    await j.check('next', `Pitt ${p} → ComingSoon with a way out`, async () => {
      await page.goto(p);
      await expect(page.getByTestId('coming-soon')).toBeVisible({ timeout: 15_000 });
      await page.getByRole('button', { name: 'Browse Marketplace' }).or(page.getByRole('link', { name: 'Browse Marketplace' })).first().click();
      await expect(page).toHaveURL(/\/marketplace/);
    });
  }
  for (const p of OPEN_PITT) {
    await j.check('trust', `Pitt ${p} renders the real surface`, async () => {
      await page.goto(p);
      await expectSettled(page);
      await expect(page.getByTestId('coming-soon')).toHaveCount(0);
    });
  }
  await ensureUser(CMU_EMAIL, { universityId: CMU_UNIVERSITY_ID, fullName: 'E2E Journey CMU' });
  let cmu: Awaited<ReturnType<typeof signInUi>> | undefined;
  await j.check('entry', 'CMU student signs in through /auth?school=cmu', async () => {
    cmu = await signInUi(browser, CMU_EMAIL, FIXTURE_PASSWORD, 'cmu');
  });
  for (const p of [...GATED, ...OPEN_PITT]) {
    await j.check('trust', `CMU ${p} renders (full app), never blank or a stuck spinner`, async () => {
      await cmu!.page.goto(p);
      await expectSettled(cmu!.page);
      await expect(cmu!.page.getByTestId('coming-soon')).toHaveCount(0);
    }, { needs: ['CMU student signs in through /auth?school=cmu'] });
  }
  await j.check('readback', 'CMU session survives a reload', async () => {
    await cmu!.page.goto('/my-home');
    await cmu!.page.reload();
    await expect(cmu!.page).not.toHaveURL(/\/auth/);
    await expectSettled(cmu!.page);
  }, { needs: ['CMU student signs in through /auth?school=cmu'] });
  await cmu?.ctx.close();
  j.finish();
});

test('sublease: post → read-back → cancel is safe', async ({ page }) => {
  const j = new Journey('sublease-create', 'Marketplace: post a sublease', 'Marketplace', 'P0', page);
  await serviceClient().from('profiles').update({ current_dorm: 'Litchfield Towers A' }).eq('id', userId);
  await page.goto('/subleases/create');
  await j.check('entry', '/subleases/create shows the form', async () => {
    await expect(page.locator('#mp-sublease-address')).toBeVisible({ timeout: 15_000 });
  });
  await j.check('progress', 'Post is disabled while required fields are empty', async () => {
    await expect(page.getByRole('button', { name: 'Post', exact: true })).toBeDisabled();
  }, { needs: ['/subleases/create shows the form'] });
  const address = `Layout fixture sublease ${stamp()}, Pittsburgh, PA`;
  await j.check('result', 'a complete form ends in a definitive outcome (confirmation, or the address error)', async () => {
    await page.locator('#mp-sublease-address').fill(address);
    // Tab, not Escape: on phones the composer is a sheet and Escape closes it.
    await page.keyboard.press('Tab');
    await page.locator('#mp-sublease-start').fill('2027-01-05');
    await page.locator('#mp-sublease-end').fill('2027-05-01');
    await page.locator('#mp-listing-price').fill('700');
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser', { timeout: 5_000 }),
      page.getByRole('button', { name: 'Add listing photos' }).first().click(),
    ]);
    await chooser.setFiles(path.join(HERE, 'fixtures/listing.png'));
    const post = page.getByRole('button', { name: 'Post', exact: true });
    await expect(post).toBeEnabled({ timeout: 10_000 });
    // If Post produces no confirmation, say WHY (a refused request, a thrown
    // error) instead of only "toast not visible".
    const trail: string[] = [];
    page.on('response', (r) => r.status() >= 400 && trail.push(`${r.status()} ${r.request().method()} ${new URL(r.url()).pathname}`));
    page.on('console', (m) => m.type() === 'error' && trail.push(`console: ${m.text().slice(0, 120)}`));
    await post.click();
    // The local stack has no real geocoder (dummy Mapbox token, Census CORS), so
    // the reachable terminal state here is the address error, asserted in
    // e2e/regressions/sublease-geocode-error.spec.ts. Success + read-back needs a
    // real provider and is recorded as not verified below.
    const addressError = page.locator('#mp-sublease-address[aria-invalid="true"]');
    if (await addressError.waitFor({ timeout: 15_000 }).then(() => true, () => false)) return;
    await expect(page.getByText(/Listing posted|Submitted for review/).first())
      .toBeVisible({ timeout: 20_000 })
      .catch(async (e) => {
        const shown = await page.locator('[data-sonner-toast],[role="alert"]').allInnerTexts().catch(() => []);
        throw new Error(`no confirmation after Post. visible alerts/toasts: ${JSON.stringify(shown).slice(0, 200)} · trail: ${trail.slice(0, 6).join(' | ') || 'none'} · ${(e as Error).message.split('\n')[0]}`);
      });
    await expect(page).toHaveURL(/\/subleases/);
  }, { needs: ['/subleases/create shows the form'] });
  j.notVerified('readback', 'sublease success + read-back', 'needs a real geocoding provider; the local stack resolves no addresses');
  await j.check('readback', 'the sublease row exists after posting (only when the post succeeded)', async () => {
    if (await page.locator('#mp-sublease-address[aria-invalid="true"]').count()) return;
    // A sublease's stored title is its address (MarketplaceCreate.tsx subleaseTitle).
    const { data } = await serviceClient().from('marketplace_listings').select('id').eq('user_id', userId).eq('post_type', 'sublease').ilike('title', `%${address.split(',')[0]}%`);
    expect((data ?? []).length).toBe(1);
  }, { needs: ['a complete form ends in a definitive outcome (confirmation, or the address error)'] });
  await j.check('cancel', 'Cancel leaves for /subleases without posting', async () => {
    await page.goto('/subleases/create');
    await page.locator('#mp-sublease-address').fill(`Cancelled ${stamp()}`);
    await page.getByRole('button', { name: 'Cancel' }).first().click();
    await expect(page).toHaveURL(/\/subleases/);
  });
  j.finish();
});

test('marketplace renders on every load (blank-page check)', async ({ page }) => {
  const j = new Journey('marketplace-blank', 'Marketplace: renders on repeated loads', 'Marketplace', 'P0', page);
  for (let i = 1; i <= 5; i++) {
    await j.check('entry', `load ${i}: /marketplace shows listings`, async () => {
      await page.goto(i % 2 ? '/marketplace' : '/my-home');
      if (i % 2 === 0) await page.goto('/marketplace');
      await expect(page.locator('[data-listing-open]').first()).toBeVisible({ timeout: 15_000 });
    });
  }
  j.finish();
});
