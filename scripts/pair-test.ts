/**
 * End to end: a desktop shows a QR code, a phone opens the link it encodes and
 * sends a photo, and the desktop picks it up and starts analysing.
 *
 * Two real browser contexts, one of them an emulated iPhone, talking to the
 * running server over its LAN address — the same path a physical phone takes.
 * Run: npx tsx scripts/pair-test.ts
 */
import { chromium, devices } from 'playwright';
import jsQR from 'jsqr';
import sharp from 'sharp';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const OUT = process.env.OUT ?? '/tmp/sketchit-shots';
const PHOTO = process.env.PHOTO ?? 'public/samples/sample-series-ok.png';

async function main() {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  const errors: string[] = [];

  const desktop = await browser.newPage({ viewport: { width: 1400, height: 900 }, deviceScaleFactor: 2 });
  desktop.on('pageerror', (e) => errors.push(`desktop: ${e.message}`));

  await desktop.goto(BASE, { waitUntil: 'networkidle' });
  await desktop.getByRole('button', { name: 'Show QR code' }).click();
  await desktop.waitForSelector('[aria-label^="QR code"] svg', { timeout: 10_000 });
  const phoneUrl = (await desktop.locator('p.font-mono').first().innerText()).trim();
  console.log('desktop shows QR for:', phoneUrl);
  await desktop.screenshot({ path: `${OUT}/p1-desktop-qr.png` });

  // Decode the code from the rendered pixels with an independent reader. A QR that
  // draws is not a QR that scans; this is the closest a test gets to a camera.
  const qrShot = await desktop.locator('[aria-label^="QR code"]').screenshot();
  const { data, info } = await sharp(qrShot).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height);
  if (decoded?.data !== phoneUrl) {
    errors.push(`QR decodes to ${JSON.stringify(decoded?.data)}, expected ${phoneUrl}`);
  } else {
    console.log('QR pixels decode to the same URL: OK');
  }

  // The phone scans the code and lands on the URL it encodes.
  const phoneContext = await browser.newContext({ ...devices['iPhone 13'] });
  const phone = await phoneContext.newPage();
  phone.on('pageerror', (e) => errors.push(`phone: ${e.message}`));
  await phone.goto(phoneUrl, { waitUntil: 'networkidle' });
  await phone.waitForSelector('text=Photograph your circuit');
  await phone.screenshot({ path: `${OUT}/p2-phone-ready.png` });
  console.log('phone loaded the capture page');

  await phone.locator('input[type=file]').setInputFiles(PHOTO);
  await phone.waitForSelector('text=Sent to your computer', { timeout: 20_000 });
  await phone.waitForTimeout(600); // let the button finish its colour transition
  await phone.screenshot({ path: `${OUT}/p3-phone-sent.png` });
  console.log('phone: sent');

  // The desktop should notice within a couple of polls and begin analysing.
  const t0 = Date.now();
  await desktop.waitForSelector('text=/Reading the page|Photo received/', { timeout: 15_000 });
  console.log(`desktop picked it up and started analysing in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await desktop.screenshot({ path: `${OUT}/p4-desktop-analysing.png` });

  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}
void main();
