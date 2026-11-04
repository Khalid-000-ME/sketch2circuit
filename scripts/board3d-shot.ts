/** Opens a board sample in the 3D view and screenshots it, with real WebGL. */
import { chromium } from 'playwright';
const BASE = process.env.BASE ?? 'http://localhost:3111';
const OUT = process.env.OUT ?? '/tmp/sketchit-shots';
async function main() {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 }, deviceScaleFactor: 1.5 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  for (const [name, file] of [['Arduino blink', 'b3d-arduino'], ['Pi pin that burns', 'b3d-pi']] as const) {
    await page.goto(BASE, { waitUntil: 'networkidle' });
    await page.getByRole('button', { name: new RegExp(name, 'i') }).click();
    await page.waitForSelector('main > header', { timeout: 60_000 });
    await page.getByRole('button', { name: '3D board' }).click();
    await page.waitForSelector('canvas', { timeout: 30_000 });
    await page.waitForTimeout(3500);
    await page.screenshot({ path: `${OUT}/${file}.png` });
  }
  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no errors');
  await browser.close();
}
void main();
