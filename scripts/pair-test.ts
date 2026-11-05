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

  // A real network is slower than loopback. Collecting the photo is delayed, which
  // is what exposed a race where the desktop dropped a photo it had just fetched.
  const delay = Number(process.env.IMAGE_DELAY_MS ?? 900);
  await desktop.route('**/api/pair/*/image', async (route) => {
    await new Promise((r) => setTimeout(r, delay));
    await route.continue();
  });

  await desktop.goto(BASE, { waitUntil: 'networkidle' });
  await desktop.getByRole('button', { name: 'Show QR code' }).click();
  await desktop.waitForSelector('[aria-label^="QR code"] svg', { timeout: 10_000 });
  // Matched by what it is, not by where it sits: the landing wordmark is also
  // monospaced, and came first in the DOM.
  const phoneUrl = (await desktop.getByText(/^https?:\/\/\S+\/m\/\S+$/).first().innerText()).trim();
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
  // Measured from the send, not from the end of the check below it.
  const t0 = Date.now();
  // The phone must still say so, not that the session ended.
  await phone.waitForTimeout(2500);
  if (await phone.getByText('This session has ended').count()) errors.push('phone switched to "This session has ended" after sending');

  // The desktop should notice within a couple of polls and begin analysing.
  // Analysis has to actually start. "Photo received" on its own is the stuck state.
  try {
    await desktop.waitForSelector('text=/Reading the page|Finding|Tracing|Building|Solving/', { timeout: 20_000 });
    console.log(`desktop picked it up and started analysing within ${((Date.now() - t0) / 1000).toFixed(1)}s of the send (an upper bound: the check above waits first)`);
  } catch {
    const stuck = await desktop.getByText('Photo received').count();
    errors.push(stuck ? 'desktop stuck on "Photo received": the photo was dropped and nothing was analysed' : 'analysis never started');
  }
  await desktop.screenshot({ path: `${OUT}/p4-desktop-analysing.png` });

  // Sending again from the same code: the link closed when the computer took the
  // photo, so the phone must say it arrived rather than that the session died.
  await phone.locator('input[type=file]').setInputFiles(PHOTO);
  await phone.waitForSelector('text=/Your photo is already there|This session has ended/', { timeout: 20_000 });
  if (await phone.getByText('This session has ended').count()) {
    errors.push('phone says the session has ended, though its photo was collected');
  } else {
    console.log('phone, on sending again: says the photo already arrived');
  }
  await phone.screenshot({ path: `${OUT}/p5-phone-again.png` });

  console.log(errors.length ? `ERRORS:\n${errors.join('\n')}` : 'no page errors');
  await browser.close();
  process.exit(errors.length ? 1 : 0);
}
void main();
