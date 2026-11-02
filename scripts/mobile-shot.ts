import { chromium } from 'playwright';
async function main() {
  const browser = await chromium.launch({
    args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
  });
  for (const [name, viewport] of [['narrow', { width: 360, height: 780 }], ['phone', { width: 414, height: 896 }]] as const) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await page.goto('http://localhost:3111', { waitUntil: 'networkidle' });
    await page.screenshot({ path: `/tmp/sketchit-shots/m-${name}-capture.png`, fullPage: true });
    await page.getByRole('button', { name: /burns out/i }).click();
    // Live analysis takes about half a minute, so this waits well past it. The
  // result header is view-agnostic: the schematic is SVG, the board is a canvas.
  await page.waitForSelector('main > header', { timeout: 180_000 });
    await page.waitForTimeout(3000);
    await page.screenshot({ path: `/tmp/sketchit-shots/m-${name}-result.png` });
    const overflow = await page.evaluate("document.documentElement.scrollWidth > window.innerWidth + 1");
    console.log(`${name}: horizontal overflow = ${overflow}`);
    await page.close();
  }
  await browser.close();
}
void main();
