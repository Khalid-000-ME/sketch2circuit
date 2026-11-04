/** Dumps the ink layer as a PNG so it can actually be looked at. */
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { inkRaster, removeRuledLines } from '../src/lib/pipeline/ink';
import { gridSize } from '../src/lib/pipeline/trace';

async function dump(raster: Uint8Array, w: number, h: number, path: string) {
  const rgb = Buffer.alloc(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    const v = raster[i] ? 0 : 255;
    rgb[i * 3] = v; rgb[i * 3 + 1] = v; rgb[i * 3 + 2] = v;
  }
  await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).png().toFile(path);
}

async function main() {
  const sample = process.argv[2] ?? 'sample-series-ok';
  const buf = readFileSync(`public/samples/${sample}.png`);
  const meta = await sharp(buf).metadata();
  const { w, h } = gridSize(meta.width!, meta.height!);

  for (const bias of [8, 14, 20]) {
    const ink = await inkRaster(buf, w, h, { bias });
    const before = ink.reduce((a, b) => a + b, 0);
    const ruled = removeRuledLines(ink, w, h);
    const after = ink.reduce((a, b) => a + b, 0);
    await dump(ink, w, h, `/tmp/ink-${sample}-bias${bias}.png`);
    console.log(`bias=${bias}: ${before} px -> ${after} px after removing ${ruled} ruled lines`);
  }
  console.log(`grid ${w}x${h}`);
}
void main();
