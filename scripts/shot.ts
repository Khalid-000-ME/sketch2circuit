/** Screenshots the app end-to-end so the 3D output can actually be looked at. */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const OUT = process.env.OUT ?? '/tmp/sketchit-shots';

async function main() {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.screenshot({ path: `${OUT}/01-capture.png` });

  const sample = process.env.SAMPLE ?? 'The one that burns out';
  await page.getByRole('button', { name: new RegExp(sample, 'i') }).click();
  await page.waitForSelector('main > header', { timeout: 180_000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/02-result.png` });

  // The 3D board is still available behind the view toggle.
  await page.getByRole('button', { name: '3D board' }).click();
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${OUT}/02b-board.png` });
  await page.getByRole('button', { name: 'Schematic' }).click();
  await page.waitForTimeout(800);

  // Click the first finding, which should select and focus its component.
  const finding = page.locator('aside button').first();
  if (await finding.count()) {
    await finding.click();
    await page.waitForTimeout(1200);
    await page.screenshot({ path: `${OUT}/03-selected.png` });
  }

  console.log(errors.length ? `CONSOLE ERRORS:\n${errors.join('\n')}` : 'no console errors');
  await browser.close();
}
void main();
