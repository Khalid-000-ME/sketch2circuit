/**
 * The written-connections checklist, driven in a browser against the cached
 * table-only sample. Start the server with SAMPLE_DEADLINE_MS=1 first.
 * Run: npx tsx scripts/spec-ui-test.ts
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const OUT = process.env.OUT ?? '/tmp/sketchit-shots';
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `   ${detail}`}`);
  if (!ok) failures++;
};

async function main() {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1500, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: /wiring table/i }).click();
  await page.waitForSelector('section[aria-label^="Connections written"]', { timeout: 60_000 });
  await page.waitForTimeout(600);
  const panel = page.locator('section[aria-label^="Connections written"]');
  const text = async () => (await panel.innerText()).replace(/\s+/g, ' ');

  check('the page\'s written lines are listed', /D13\s*->\s*R1/.test(await text()) && /LED\s*\+/.test(await text()), await text());
  check('all three are already in the circuit', /3 of 3 in the circuit/.test(await text()), await text());
  check('the circuit was built from the writing alone', (await page.locator('rect[aria-label^="R1,"]').count()) === 1);
  await page.screenshot({ path: `${OUT}/s1-table.png` });

  // Break one connection by hand: the checklist must notice, not keep believing the page.
  await page.locator('circle[aria-label^="D1.cathode,"]').click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.waitForTimeout(700);
  check('removing a connection by hand is noticed', /2 of 3 in the circuit/.test(await text()), await text());
  check('and offers to put it back', (await panel.getByRole('button', { name: 'Connect' }).count()) === 1);
  await page.screenshot({ path: `${OUT}/s2-broken.png` });

  await panel.getByRole('button', { name: 'Connect' }).click();
  await page.waitForTimeout(700);
  check('one click restores it from the table', /3 of 3 in the circuit/.test(await text()), await text());

  // A conflict: join the table's endpoints to other things first.
  await page.locator('circle[aria-label^="R1.a,"]').click();
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await page.waitForTimeout(500);
  await page.locator('circle[aria-label^="R1.a,"]').click();
  await page.locator('circle[aria-label^="D1.cathode,"]').click(); // R1.a now sits with the LED's cathode
  await page.waitForTimeout(500);
  // And D13 onto the LED's anode. Now "D13 -> R1" has both ends on other connections.
  await page.locator('circle[aria-label^="U1.D13,"]').click();
  await page.locator('circle[aria-label^="D1.anode,"]').click();
  await page.waitForTimeout(700);
  const t = await text();
  check('a line that would merge two connections is flagged, not applied', /Use the table/.test(t) && /already joined/.test(t), t);
  await page.screenshot({ path: `${OUT}/s3-conflict.png` });

  // Using the table is a deliberate act, and it does what it says.
  await panel.getByRole('button', { name: 'Use the table' }).click();
  await page.waitForTimeout(700);
  check('"Use the table" applies the merge on request', /3 of 3 in the circuit/.test(await text()), await text());

  console.log(errors.length ? `PAGE ERRORS:\n${errors.join('\n')}` : 'no page errors');
  if (errors.length) failures++;
  await browser.close();
  console.log(failures ? `\n${failures} failure(s)` : '\nthe checklist tracks the circuit');
  process.exit(failures ? 1 : 0);
}
void main();
