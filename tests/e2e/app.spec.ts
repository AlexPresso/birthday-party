import { test, expect, request, type APIRequestContext, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';

const baseURL = 'http://localhost:3300';
const mutationHeaders = { 'X-Requested-With': 'birthday-party', Origin: baseURL };
let admin: APIRequestContext;

function tokenFrom(url: string) {
  const token = new URLSearchParams(new URL(url).hash.slice(1)).get('token');
  if (!token) throw new Error('The invitation URL has no token fragment.');
  return token;
}

async function invite(name: string) {
  const response = await admin.post('/api/admin/guests', { data: { name } });
  expect(response.status()).toBe(201);
  return response.json() as Promise<{ guest: { id: number; name: string }; invitationUrl: string }>;
}

async function enter(page: Page, url: string) {
  await page.goto(url);
  await page.getByRole('button', { name: 'Entrer', exact: true }).click();
  await expect(page).toHaveURL(/\/photos$/);
}

test.beforeAll(async () => {
  const output = execFileSync(process.execPath, ['scripts/backend.mjs', 'invite-admin', '--name', 'Hôte de test'], {
    cwd: process.cwd(),
    env: { ...process.env, DATA_DIR: process.env.BIRTHDAY_E2E_DATA_DIR, PUBLIC_URL: baseURL, COOKIE_SECURE: 'false' },
    encoding: 'utf8',
    timeout: 120_000,
  });
  const match = output.match(/http:\/\/localhost:3300\/invitation#token=[A-Za-z0-9_-]+/);
  if (!match) throw new Error('Host bootstrap did not return an invitation URL.');
  admin = await request.newContext({ baseURL, extraHTTPHeaders: mutationHeaders });
  const accepted = await admin.post('/api/invitations/accept', { data: { token: tokenFrom(match[0]) } });
  expect(accepted.status()).toBe(200);
});

test.afterAll(async () => { await admin?.dispose(); });

test('private APIs and pages require an invitation; cross-origin changes are rejected', async ({ page }) => {
  for (const path of ['/api/session', '/api/photos', '/api/programme', '/api/guestbook', '/api/party', '/api/admin/guests']) {
    expect((await page.request.get(path)).status()).toBe(401);
  }
  await page.goto('/photos');
  await expect(page).toHaveURL(/\/invitation/);
  const denied = await admin.post('/api/admin/guests', {
    data: { name: 'Ne doit pas être créé' }, headers: { Origin: 'https://untrusted.example' },
  });
  expect(denied.status()).toBe(403);
});

test('a guest can activate once, use the four tabs, upload a photo and sign the guestbook', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const invitation = await invite('Camille Test');
  const token = tokenFrom(invitation.invitationUrl);
  // Reading a preview must not consume the invitation.
  const preview = await page.request.post('/api/invitations/preview', { data: { token }, headers: mutationHeaders });
  expect(preview.status()).toBe(200);
  await enter(page, invitation.invitationUrl);
  expect(new URL(page.url()).hash).toBe('');
  const session = await page.request.get('/api/session');
  expect((await session.json()).guest.id).toBe(invitation.guest.id);
  const cookies = await page.context().cookies();
  expect(cookies.some(cookie => cookie.httpOnly)).toBeTruthy();
  const reused = await page.request.post('/api/invitations/accept', { data: { token }, headers: mutationHeaders });
  expect(reused.ok()).toBeFalsy();
  // Returning through the original message still works while the session is valid.
  await page.goto(invitation.invitationUrl);
  await expect(page).toHaveURL(/\/photos$/);

  for (const name of ['photos', 'programme', "livre d'or", 'paramètres']) {
    await expect(page.getByRole('navigation').getByRole('link', { name, exact: true })).toBeVisible();
  }
  const screenshot = await page.screenshot({ caret: 'initial' });
  await page.getByLabel('Ajouter des photos', { exact: true }).setInputFiles({
    name: 'souvenir-test.png', mimeType: 'image/png', buffer: screenshot,
  });
  await expect.poll(async () => (await (await page.request.get('/api/photos')).json()).items.length).toBeGreaterThan(0);
  const photos = await (await page.request.get('/api/photos')).json();
  const owned = photos.items.find((photo: { author: { id: number } }) => photo.author.id === invitation.guest.id);
  expect(owned).toBeTruthy();
  expect((await page.request.get(owned.thumbnailUrl)).status()).toBe(200);
  const photoTile = page.getByRole('button', { name: /^Ouvrir la photo de Camille Test/ });
  await expect(photoTile).toBeVisible();
  await page.getByRole('button', { name: 'Fermer', exact: true }).click();
  await page.screenshot({ path: 'test-results/photos-mobile.png', fullPage: true, caret: 'initial' });
  await photoTile.click();
  await expect(page.getByRole('dialog', { name: 'Photo de la fête' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Photo de la fête' })).toBeHidden();
  await expect(photoTile).toBeFocused();

  await page.getByRole('navigation').getByRole('link', { name: "livre d'or", exact: true }).click();
  await page.getByLabel('Ton message', { exact: true }).fill('Un beau souvenir, signé depuis le test du parcours invité.');
  await page.getByRole('button', { name: 'Publier le message', exact: true }).click();
  await expect(page.getByText('Un beau souvenir, signé depuis le test du parcours invité.', { exact: true })).toBeVisible();
  await expect(page.locator('article').getByText('Camille Test', { exact: true })).toBeVisible();
  await page.reload();
  expect((await (await page.request.get('/api/session')).json()).guest.id).toBe(invitation.guest.id);
  await page.screenshot({ path: 'test-results/guestbook-mobile.png', fullPage: true, caret: 'initial' });

  await page.getByRole('navigation').getByRole('link', { name: 'programme', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Programme', exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/programme-mobile.png', fullPage: true, caret: 'initial' });
  await page.getByRole('navigation').getByRole('link', { name: 'paramètres', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Paramètres', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Camille Test', exact: true })).toBeVisible();
  expect((await page.request.get('/api/admin/guests')).status()).toBe(403);
  await page.screenshot({ path: 'test-results/settings-mobile.png', fullPage: true, caret: 'initial' });
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
});

test('scheduled secrets stay on the server and revocation protects media', async ({ page }) => {
  const invitation = await invite('Alex Test');
  await enter(page, invitation.invitationUrl);
  const eventResponse = await admin.post('/api/admin/programme', { data: {
    title: 'CONFIDENTIEL-TITRE-TEST', description: 'CONFIDENTIEL-DESCRIPTION-TEST',
    teaser: 'Une surprise à découvrir', startsAt: null,
    unlockAt: new Date(Date.now() + 3_600_000).toISOString(),
  } });
  expect(eventResponse.status()).toBe(201);
  const event = await eventResponse.json();
  const programme = await page.request.get('/api/programme');
  const payload = await programme.text();
  expect(payload).not.toContain('CONFIDENTIEL');
  expect(payload).toContain('Une surprise à découvrir');
  await page.goto('/programme');
  await expect(page.getByText('Une surprise à découvrir', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/programme-desktop.png', fullPage: true, caret: 'initial' });

  const unlocked = await admin.put(`/api/admin/programme/${event.id}`, { data: {
    title: 'CONFIDENTIEL-TITRE-TEST', description: 'CONFIDENTIEL-DESCRIPTION-TEST',
    teaser: 'Une surprise à découvrir', startsAt: null,
    unlockAt: new Date(Date.now() - 1000).toISOString(),
  } });
  expect(unlocked.status()).toBe(200);
  await page.getByRole('button', { name: 'Actualiser le programme' }).click();
  await expect(page.getByText('CONFIDENTIEL-TITRE-TEST', { exact: true })).toBeVisible();

  const image = await page.screenshot({ caret: 'initial' });
  const upload = await page.request.post('/api/photos', {
    headers: mutationHeaders,
    multipart: { file: { name: 'test.png', mimeType: 'image/png', buffer: image } },
  });
  expect(upload.status()).toBe(201);
  const photo = await upload.json();
  expect((await page.request.get(photo.url)).status()).toBe(200);
  const revoked = await admin.delete(`/api/admin/guests/${invitation.guest.id}`);
  expect(revoked.status()).toBe(204);
  expect((await page.request.get(photo.url)).status()).toBe(401);
  expect((await page.request.get('/api/session')).status()).toBe(401);
  await admin.delete(`/api/admin/programme/${event.id}`);
});

test('the host can manage party details, named invitations and scheduled events', async ({ browser }) => {
  const context = await browser.newContext({ baseURL, storageState: await admin.storageState(), viewport: { width: 1440, height: 1000 }, timezoneId: 'Europe/Zurich', locale: 'fr-CH' });
  const page = await context.newPage();
  await page.goto('/parametres');
  await page.getByLabel('Nom de la fête', { exact: true }).fill('Les 30 ans — fête de test');
  await page.getByRole('button', { name: 'Enregistrer la fête', exact: true }).click();
  await expect(page.getByText('Les infos de la fête sont enregistrées.', { exact: true })).toBeVisible();
  expect((await (await admin.get('/api/party')).json()).title).toBe('Les 30 ans — fête de test');
  await page.locator('summary').filter({ hasText: 'Les invités' }).click();
  await page.getByLabel('Prénom de l’invité', { exact: true }).fill('Invité créé depuis les paramètres');
  await page.getByRole('button', { name: 'Créer l’invitation', exact: true }).click();
  await expect(page.getByText('Invité créé depuis les paramètres', { exact: true })).toBeVisible();
  const guests = await (await admin.get('/api/admin/guests')).json();
  expect(guests.items.some((guest: { name: string }) => guest.name === 'Invité créé depuis les paramètres')).toBeTruthy();
  await page.screenshot({ path: 'test-results/host-settings-desktop.png', fullPage: true, caret: 'initial' });
  await page.locator('summary').filter({ hasText: 'Le programme' }).click();
  await page.getByRole('button', { name: 'Ajouter un événement', exact: true }).click();
  await page.getByLabel('Titre de l’événement', { exact: true }).fill('Rendez-vous créé par l’hôte');
  await page.getByLabel('Détails', { exact: true }).fill('Les détails secrets du rendez-vous.');
  await page.getByLabel('Indice visible en attendant', { exact: true }).fill('Gardez cette date !');
  await page.getByLabel('Début de l’événement', { exact: true }).fill('2030-06-01T19:00');
  await page.getByLabel('Dévoiler les détails le', { exact: true }).fill('2030-06-01T18:00');
  await page.getByRole('button', { name: 'Enregistrer l’événement', exact: true }).click();
  await expect(page.getByText('Rendez-vous créé par l’hôte', { exact: true })).toBeVisible();
  const programme = await (await admin.get('/api/admin/programme')).json();
  const event = programme.items.find((item: { title: string }) => item.title === 'Rendez-vous créé par l’hôte');
  expect(event.startsAt).toBe('2030-06-01T17:00:00Z');
  expect(event.unlockAt).toBe('2030-06-01T16:00:00Z');
  await page.setViewportSize({ width: 320, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBeTruthy();
  await context.close();
});
