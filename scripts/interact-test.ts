/**
 * Drives the schematic editor the way a person does and asserts what happens.
 *
 * Runs against the cached bundled sample, so it needs no Model API and does not
 * depend on its mood: what is under test is the editing, not the perception.
 * Start the server with SAMPLE_DEADLINE_MS=1 first.
 *
 * Run: npx tsx scripts/interact-test.ts
 */
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const OUT = process.env.OUT ?? '/tmp/sketchit-shots';
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `   ${detail}`}`);
  if (!ok) failures++;
};

const part = (page: Page, id: string) => page.locator(`rect[aria-label^="${id},"]`);
const pin = (page: Page, ref: string) => page.locator(`circle[aria-label^="${ref},"]`);
const centre = async (page: Page, id: string) => {
  const b = (await part(page, id).boundingBox())!;
  return { x: Math.round(b.x + b.width / 2), y: Math.round(b.y + b.height / 2) };
};
/**
 * Where a part sits relative to two parts that never move, in units of the
 * distance between those two. Panning and zooming change screen coordinates and
 * leave this alone, which is the point: selecting a part brings it into view, so
 * comparing screen positions would call the camera moving a part moving.
 */
const placed = async (page: Page, id: string) => {
  const b = await centre(page, 'B1');
  const d = await centre(page, 'D1');
  const p = await centre(page, id);
  const unit = Math.hypot(d.x - b.x, d.y - b.y);
  return { x: (p.x - b.x) / unit, y: (p.y - b.y) / unit };
};
const same = (a: { x: number; y: number }, b: { x: number; y: number }, tol = 0.02) =>
  Math.abs(a.x - b.x) < tol && Math.abs(a.y - b.y) < tol;
const findingsText = async (page: Page) => (await page.locator('aside').innerText()).replace(/\s+/g, ' ');

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // A passive-listener intervention is a console message, not a page error.
  page.on('console', (m) => { if (/passive|intervention/i.test(m.text())) errors.push(`console: ${m.text()}`); });

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /circuit that works/i }).click();
  await page.waitForSelector('main > header', { timeout: 60_000 });
  await page.waitForSelector('rect[aria-label^="R1,"]');
  await page.waitForTimeout(500);

  // ── Zoom ──────────────────────────────────────────────────────────────────
  const widthBefore = (await part(page, 'R1').boundingBox())!.width;
  const scrollBefore = await page.evaluate('window.scrollY');
  const c0 = await centre(page, 'R1');
  await page.mouse.move(c0.x, c0.y);
  await page.mouse.wheel(0, -100); // one notch of a mouse wheel
  await page.waitForTimeout(250);
  const widthAfter = (await part(page, 'R1').boundingBox())!.width;
  check('one wheel notch zooms by about a sixth', widthAfter > widthBefore * 1.1 && widthAfter < widthBefore * 1.25, `${widthBefore} -> ${widthAfter}`);
  check('and does not scroll the page behind it', (await page.evaluate('window.scrollY')) === scrollBefore);
  // A trackpad is dozens of tiny events; together they must not run away.
  const w1 = (await part(page, 'R1').boundingBox())!.width;
  for (let i = 0; i < 40; i++) await page.mouse.wheel(0, -4);
  await page.waitForTimeout(250);
  const w2 = (await part(page, 'R1').boundingBox())!.width;
  check('a trackpad flick zooms proportionally, not wildly', w2 > w1 && w2 < w1 * 1.4, `${w1} -> ${w2}`);
  await page.getByRole('button', { name: 'Fit' }).click(); // back to a view the rest of the test can reach
  await page.waitForTimeout(300);

  // ── Drag ──────────────────────────────────────────────────────────────────
  const before = await placed(page, 'R1');
  const start = await centre(page, 'R1');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 140, start.y + 90, { steps: 10 });
  await page.mouse.up();
  await page.waitForTimeout(300);
  const dragged = await placed(page, 'R1');
  check('dragging moves the part', !same(before, dragged, 0.1), `${JSON.stringify(before)} -> ${JSON.stringify(dragged)}`);
  check('a drag is not a click (nothing was selected)', !(await page.locator('aside').innerText()).includes('Operating point'));

  // ── An unrelated edit must not move it ────────────────────────────────────
  await page.locator('aside').getByRole('button', { name: /^R1/ }).click();
  const input = page.locator('input[inputmode="decimal"]').first();
  await input.fill('330');
  await input.press('Enter');
  await page.waitForTimeout(800);
  const afterValue = await placed(page, 'R1');
  check('changing a value does not move a placed part', same(afterValue, dragged), `${JSON.stringify(dragged)} -> ${JSON.stringify(afterValue)}`);

  // ── Add a part ────────────────────────────────────────────────────────────
  await page.getByRole('button', { name: 'Add part' }).click();
  await page.getByRole('menuitem', { name: /^Resistor/ }).click();
  await page.waitForSelector('rect[aria-label^="R2,"]');
  await page.waitForTimeout(800);
  check('an added part appears', (await part(page, 'R2').count()) === 1);
  check('and is listed with the others', (await page.locator('aside').getByRole('button', { name: /^R2/ }).count()) === 1);
  const afterAdd = await placed(page, 'R1');
  check('adding a part does not move placed parts', same(afterAdd, dragged), `${JSON.stringify(dragged)} -> ${JSON.stringify(afterAdd)}`);
  check('a lone resistor is reported as floating', /R2.*connect/.test(await findingsText(page)) && /floating|connect[s]? to nothing/i.test(await findingsText(page)), (await findingsText(page)).slice(0, 220));
  await page.screenshot({ path: `${OUT}/e1-added.png` });

  // ── Wire it, pin to pin ───────────────────────────────────────────────────
  await pin(page, 'R2.a').click();
  check('clicking a pin starts a wire', (await page.locator('text=/Wiring from/').count()) === 1);
  await pin(page, 'R1.a').click();
  await page.waitForTimeout(500);
  await pin(page, 'R2.b').click();
  await pin(page, 'R1.b').click();
  await page.waitForTimeout(900);
  const wired = await findingsText(page);
  check('wiring both pins clears the floating warning', !/R2.*(connects? to nothing|floating)/i.test(wired), wired.slice(0, 260));
  const afterWire = await placed(page, 'R1');
  check('wiring does not move placed parts', same(afterWire, dragged), `${JSON.stringify(dragged)} -> ${JSON.stringify(afterWire)}`);
  await page.screenshot({ path: `${OUT}/e2-wired.png` });

  // ── Disconnect ────────────────────────────────────────────────────────────
  await pin(page, 'R2.b').click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.waitForTimeout(800);
  check('disconnecting a pin brings the warning back', /R2/.test(await findingsText(page)) && /connect/.test(await findingsText(page)));

  // ── Rotate and delete from the keyboard ───────────────────────────────────
  await part(page, 'R2').click();
  const beforeRot = await part(page, 'R2').boundingBox();
  await page.keyboard.press('r');
  await page.waitForTimeout(300);
  const afterRot = (await part(page, 'R2').boundingBox())!;
  check('R turns the selected part', Math.abs(afterRot.width - beforeRot!.height) < 2 || Math.abs(afterRot.height - beforeRot!.width) < 2, `${JSON.stringify(beforeRot)} -> ${JSON.stringify(afterRot)}`);

  await page.keyboard.press('Delete');
  await page.waitForTimeout(800);
  check('Delete removes the selected part', (await part(page, 'R2').count()) === 0);

  // ── Esc cancels a wire in progress ────────────────────────────────────────
  await pin(page, 'R1.a').click();
  await page.keyboard.press('Escape');
  check('Esc cancels a wire in progress', (await page.locator('text=/Wiring from/').count()) === 0);

  console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
  if (errors.length) failures++;
  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nall interactions behave');
  process.exit(failures ? 1 : 0);
}
void main();
