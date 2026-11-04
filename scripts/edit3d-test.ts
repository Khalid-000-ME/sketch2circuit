/**
 * Edits a circuit in the 3D view with a real pointer: drag a part, wire two pins,
 * remove a wire, turn a part, delete a part, and check the positions survive an
 * edit. Run: npx tsx scripts/edit3d-test.ts   (server on :3111)
 */
import { chromium, type Page } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const OUT = process.env.OUT ?? '/tmp/sketchit-shots';
let failed = 0;
const check = (name: string, ok: boolean, detail = '') => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${ok ? '' : ` ${detail}`}`); };

type Info = {
  parts: Record<string, { x: number; z: number; rot: number; screen: { x: number; y: number } }>;
  pins: Record<string, { x: number; y: number }>;
  wires: Array<{ net: string; pins: [string, string | null]; screen: { x: number; y: number } }>;
  nets: string[][];
};
const info = (page: Page) => page.evaluate(() => (window as unknown as { __scene3d: { inspect(): unknown } }).__scene3d.inspect()) as Promise<Info>;

async function main() {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const page = await browser.newPage({ viewport: { width: 1500, height: 950 } });
  page.setDefaultTimeout(15_000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

  await page.goto(`${BASE}/?e2e`, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /Series circuit that works|series/i }).first().click();
  await page.waitForSelector('main > header', { timeout: 60_000 });
  await page.getByRole('button', { name: '3D board' }).click();
  await page.waitForSelector('canvas', { timeout: 30_000 });
  await page.waitForTimeout(3500);

  let i = await info(page);
  const ids = Object.keys(i.parts);
  check('three parts on the board', ids.length === 3, ids.join(','));
  const pick = ids.find((id) => id.startsWith('R'))!;

  // 1. Drag a resistor to the right.
  const before = i.parts[pick];
  await page.mouse.move(before.screen.x, before.screen.y);
  await page.mouse.down();
  await page.mouse.move(before.screen.x + 60, before.screen.y + 10, { steps: 6 });
  await page.mouse.move(before.screen.x + 140, before.screen.y + 20, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(400);
  i = await info(page);
  const after = i.parts[pick];
  check(`${pick} moved when dragged`, Math.hypot(after.x - before.x, after.z - before.z) > 0.4, JSON.stringify({ before, after }));
  const nearest = Math.min(...ids.filter((id) => id !== pick).map((id) => Math.hypot(i.parts[id].x - after.x, i.parts[id].z - after.z)));
  check('not dropped onto another part', nearest > 0.8, `nearest ${nearest.toFixed(2)}`);
  check('wires follow the part', i.wires.length >= 3);
  await page.screenshot({ path: `${OUT}/edit3d-dragged.png` });

  // 2. Positions survive an edit (adding a part rebuilds the scene).
  await page.getByRole('button', { name: 'Add part' }).click();
  await page.getByRole('menuitem', { name: /^.*Capacitor$/ }).first().click();
  await page.waitForTimeout(1200);
  i = await info(page);
  const kept = i.parts[pick];
  check('dragged part stays put after an edit', Math.hypot(kept.x - after.x, kept.z - after.z) < 0.01, JSON.stringify({ after, kept }));
  check('new part appears', Object.keys(i.parts).length === 4);
  // Adding a part grows the board. Everything must stay inside the canvas, or it
  // is both invisible and unclickable — a part you cannot reach is not editable.
  const box = (await page.locator('canvas').boundingBox())!;
  const outside = Object.entries(i.pins)
    .filter(([, p]) => p.x < box.x || p.x > box.x + box.width || p.y < box.y || p.y > box.y + box.height)
    .map(([ref]) => ref);
  check('every pin stays on screen after adding a part', outside.length === 0, `off-screen: ${outside.join(', ')}`);
  const cap = Object.keys(i.parts).find((id) => id.startsWith('C'))!;

  // 3. Wire two pins by clicking them.
  const netsBefore = i.nets.length;
  const a = `${cap}.a`;
  const target = i.nets.flat().find((p) => p.startsWith('B1.neg'))!;
  await page.mouse.click(i.pins[a].x, i.pins[a].y);
  await page.waitForTimeout(200);
  check('a pin click starts a wire', await page.getByText(/Wiring from/).count() > 0);
  await page.mouse.click(i.pins[target].x, i.pins[target].y);
  await page.waitForTimeout(1200);
  i = await info(page);
  check('the second click connects them', i.nets.some((n) => n.includes(a) && n.includes(target)), JSON.stringify(i.nets));
  void netsBefore;
  await page.screenshot({ path: `${OUT}/edit3d-wired.png` });

  // 4. Click the new wire and remove it.
  const wire = i.wires.find((w) => w.pins[0] === a || w.pins[1] === a);
  check('the new wire exists', Boolean(wire));
  if (wire) {
    await page.mouse.click(wire.screen.x, wire.screen.y);
    await page.waitForTimeout(300);
    const removable = await page.getByRole('button', { name: /Remove wire|Disconnect pin/ }).count() > 0;
    check('clicking a wire offers to remove it', removable);
    if (removable) {
      await page.getByRole('button', { name: /Remove wire|Disconnect pin/ }).click();
      await page.waitForTimeout(1200);
      i = await info(page);
      check('the connection is gone', !i.nets.some((n) => n.includes(a)), JSON.stringify(i.nets));
    }
  }

  // 5. Turn a part with R.
  i = await info(page);
  const rotBefore = i.parts[pick].rot;
  // Selected from the list: a wire often arcs over the middle of a part.
  await page.getByRole('button', { name: new RegExp(`^${pick}`) }).first().click();
  await page.waitForTimeout(300);
  await page.keyboard.press('r');
  await page.waitForTimeout(500);
  i = await info(page);
  check('R turns the selected part a quarter', Math.abs(i.parts[pick].rot - rotBefore - Math.PI / 2) < 1e-6, `${rotBefore} -> ${i.parts[pick].rot}`);

  // 6. Delete a part with Delete.
  await page.keyboard.press('Delete');
  await page.waitForTimeout(1200);
  i = await info(page);
  check('Delete removes the selected part', !(pick in i.parts), Object.keys(i.parts).join(','));

  check('no browser errors', errors.length === 0, errors.join(' | '));
  await browser.close();
  process.exit(failed ? 1 : 0);
}
main().catch((e) => { console.log(`FAIL crashed: ${(e as Error).message.split('\n').slice(0, 6).join(' | ')}`); process.exit(1); });
