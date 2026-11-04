/**
 * Drives the describe-a-part flow in a real browser.
 *
 * The model call is answered from a canned reply (a verified starter part under a
 * different name), so this checks the interface, not the model. Live behaviour is
 * checked by scripts/live-parts.ts.
 *
 * Run: npx tsx scripts/describe-ui-test.ts   (server on :3111)
 */
import { chromium } from 'playwright';
import { STARTER_PARTS } from '../src/fixtures/parts';
import { runChecks } from '../src/lib/circuit/part-checks';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const OUT = process.env.OUT ?? '/tmp/sketchit-shots';
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); };

async function main() {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  const def = { ...STARTER_PARTS.find((p) => p.name === 'N-MOSFET (logic level)')!, name: '2N7000 MOSFET' };
  await page.route('**/api/part', async (route) => {
    const body = route.request().postDataJSON() as { description: string };
    await route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ buildable: true, reason: '', part: def, checks: runChecks(def), verified: true, attempts: 1, problems: [], echo: body.description }),
    });
  });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Series circuit that works|series/i }).first().click();
  await page.waitForSelector('main > header', { timeout: 60_000 });

  // Palette: starter parts are listed.
  await page.getByRole('button', { name: 'Add part' }).click();
  check('palette lists the starter relay', await page.getByRole('menuitem', { name: /5V relay/ }).count() > 0);
  check('palette has Describe a part', await page.getByRole('menuitem', { name: /Describe a part/ }).count() > 0);
  await page.screenshot({ path: `${OUT}/describe-palette.png` });

  // Add the starter relay straight from the palette.
  await page.getByRole('menuitem', { name: /5V relay/ }).click();
  await page.waitForTimeout(800);
  check('relay appears with its own reference (K1)', await page.locator('text=K1').count() > 0);
  await page.screenshot({ path: `${OUT}/describe-relay-added.png` });

  // Describe a part.
  await page.getByRole('button', { name: 'Add part' }).click();
  await page.getByRole('menuitem', { name: /Describe a part/ }).click();
  const dialog = page.getByRole('dialog');
  check('dialog opens', await dialog.isVisible());
  await dialog.getByRole('button', { name: /2N7000|MOSFET/ }).first().click().catch(() => {});
  await dialog.getByLabel('Part description').fill('A 2N7000 N-channel MOSFET');
  await dialog.getByRole('button', { name: 'Make part' }).click();
  await dialog.getByText('Passed its own checks').waitFor({ timeout: 15_000 });
  check('shows the solver checks', await dialog.getByText('What the solver measured').isVisible());
  check('shows what it assumes and does not model', await dialog.getByText('It assumes').isVisible() && await dialog.getByText('It does not model').isVisible());
  await page.screenshot({ path: `${OUT}/describe-dialog.png` });
  await dialog.getByRole('button', { name: 'Add to circuit' }).click();
  await page.waitForTimeout(1000);
  check('described part is on the page', await page.locator('text=Q1').count() > 0);

  // Saved: appears under My parts, and survives a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Series circuit that works|series/i }).first().click();
  await page.waitForSelector('main > header', { timeout: 60_000 });
  await page.getByRole('button', { name: 'Add part' }).click();
  check('kept in My parts after a reload', await page.getByText('My parts').count() > 0 && await page.getByRole('menuitem', { name: /2N7000/ }).count() > 0);
  await page.keyboard.press('Escape');

  // The 3D view builds the part too.
  await page.getByRole('button', { name: 'Add part' }).click();
  await page.getByRole('menuitem', { name: /5V relay/ }).click();
  await page.waitForTimeout(600);
  await page.getByRole('button', { name: '3D board' }).click();
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForTimeout(3500);
  await page.screenshot({ path: `${OUT}/describe-3d.png` });

  check('no browser errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(failed ? 1 : 0);
}
void main();
