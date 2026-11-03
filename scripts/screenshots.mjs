// Captures README screenshots from the dev server (npm run dev must be running).
import { chromium } from '@playwright/test';

const base = process.env.URL ?? 'http://localhost:5173/game/';
const browser = await chromium.launch({ channel: process.env.PW_CHANNEL ?? 'chrome', args: ['--ignore-gpu-blocklist', '--enable-gpu-rasterization'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const wait = (ms) => page.waitForTimeout(ms);
await page.goto(base);
await wait(4000);
await page.evaluate(() => window.__cs.useUi.setState({ toasts: [] }));
await page.screenshot({ path: 'docs/screenshots/menu.png' });

await page.evaluate(async () => {
  const s = await import('/game/src/game/session.ts');
  await s.startOffline({ map: 'skyline', mode: 'turf', duration: 180, difficulty: 'hard', allies: 3, rivals: 4 });
});
await wait(2500);
await page.evaluate(() => {
  const v = window.__cs.engine.view;
  const sim = v.source.sim;
  for (let i = 0; i < 60 * 75; i++) sim.step();
  v.cam.yaw = Math.PI + 0.25;
  v.cam.pitch = -0.28;
  window.__cs.engine.input.engaged = true;
});
await wait(2500);
await page.evaluate(() => window.__cs.useUi.setState({ toasts: [] }));
await page.screenshot({ path: 'docs/screenshots/match.png' });

await page.evaluate(() => {
  const sim = window.__cs.engine.view.source.sim;
  for (let i = 0; i < 60 * 130 && sim.phase !== 'ended'; i++) sim.step();
});
await wait(4500);
await page.screenshot({ path: 'docs/screenshots/results.png' });
await browser.close();
console.log('screenshots written');
