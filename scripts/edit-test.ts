/** Exercises the edit path end to end: change a value, watch the findings change. */
import { chromium } from 'playwright';

async function main() {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 2 });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto('http://localhost:3111', { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /circuit that works/i }).click();
  await page.waitForSelector('canvas');
  await page.waitForTimeout(2500);
  console.log('before edit:', (await page.locator('main > header').innerText()).replace(/\n/g, ' | '));

  // Select R1 from the component list and drop its value to something unsafe.
  await page.getByRole('button', { name: /^R1/ }).click();
  await page.waitForTimeout(500);
  const input = page.locator('input[inputmode="decimal"]').first();
  await input.fill('22');
  await input.press('Enter');
  const t0 = Date.now();
  await page.waitForFunction("document.querySelector('header').innerText.includes('problem')", null, { timeout: 5000 });
  console.log(`after edit (${Date.now() - t0}ms):`, (await page.locator('main > header').innerText()).replace(/\n/g, ' | '));
  console.log('finding:', (await page.locator('aside li').first().innerText()).replace(/\n/g, ' '));
  await page.screenshot({ path: '/tmp/sketchit-shots/04-edited.png' });

  // And back again: a safe value should clear the finding.
  await input.fill('470');
  await input.press('Enter');
  await page.waitForFunction("document.querySelector('header').innerText.includes('No errors')", null, { timeout: 5000 });
  console.log('after fix:', (await page.locator('main > header').innerText()).replace(/\n/g, ' | '));

  console.log(errors.length ? `ERRORS: ${errors.join('; ')}` : 'no console errors');
  await browser.close();
}
void main();
