import { expect, test } from '@playwright/test';

test('loads under /game/ with every asset resolving', async ({ page }) => {
  const failed: string[] = [];
  const errors: string[] = [];
  page.on('response', (r) => r.status() >= 400 && failed.push(`${r.status()} ${r.url()}`));
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('./');
  await expect(page).toHaveTitle('CHROMASHIFT');
  for (const item of ['Play', 'Online', 'Practice', 'Locker', 'Progression', 'Settings']) {
    await expect(page.locator('.menu__label', { hasText: item })).toBeVisible();
  }
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute('href', /\/game\/manifest\.webmanifest$/);
  const manifest = await (await page.request.get('manifest.webmanifest')).json();
  expect(manifest.start_url).toBe('/game/');
  expect(failed.filter((f) => !f.includes('chroma-server.json'))).toEqual([]);
  expect(errors).toEqual([]);
});

test('plays an offline match against seven bots', async ({ page }) => {
  await page.goto('./');
  await page.locator('.menu__label', { hasText: 'Play' }).click();
  await page.getByRole('button', { name: /Practice Against Bots/ }).click();
  const timer = page.locator('.timer');
  await expect(timer).toBeVisible({ timeout: 30_000 });
  // Bots paint the arena: team coverage climbs above zero once play starts.
  await expect
    .poll(async () => Number((await page.locator('.score').first().innerText()).replace(/[^\d.]/g, '')), { timeout: 60_000 })
    .toBeGreaterThan(0);
  await expect(page.locator('.loadout')).toContainText('Pulse Sprayer');
});

test('settings persist across reloads', async ({ page }) => {
  await page.goto('./');
  await page.locator('.menu__label', { hasText: 'Settings' }).click();
  await page.getByRole('button', { name: 'Very Low', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Very Low', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.reload();
  const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('chromashift.settings.v1') ?? '{}'));
  expect(stored.state.graphics.preset).toBe('veryLow');
  expect(stored.state.graphics.shadowQuality).toBe(0);
  expect(stored.state.graphics.ambientOcclusion).toBe(false);
});

test('explains when WebGL2 is unavailable', async ({ page }) => {
  await page.addInitScript(() => {
    const orig = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (type: string, ...rest: unknown[]) {
      if (type === 'webgl2') return null;
      return (orig as (...a: unknown[]) => unknown).call(this, type, ...rest);
    } as typeof orig;
  });
  await page.goto('./');
  await expect(page.getByText('This device can’t run CHROMASHIFT')).toBeVisible();
});
