/**
 * Iterates on the wire trace without re-paying for perception.
 *
 * The first run calls Spark and SAM and caches the components plus the decoded
 * wire rasters to disk; later runs load the cache, so the trace itself can be
 * debugged for free.
 *
 * Run: npx tsx --env-file=.env.local scripts/probe-trace.ts [sample] [--refresh]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { readSketch } from '../src/lib/meta/spark';
import { DEFAULT_WIRE_CONCEPTS, isPageFurniture, segmentByBoxes, segmentConcepts } from '../src/lib/meta/sam';
import { normaliseType } from '../src/lib/circuit/graph';
import { PINS, type CircuitComponent } from '../src/lib/types';
import { buildTraceGrid, buildWireGrid, labelRegions, pinAnchors, traceNets } from '../src/lib/pipeline/trace';
import type { SamMask } from '../src/lib/meta/sam';

const CACHE_DIR = '/tmp/sketchit-trace-cache';
const sample = process.argv[2] ?? 'sample-series-ok';
const refresh = process.argv.includes('--refresh');
const cachePath = `${CACHE_DIR}/${sample}.json`;

type SerialMask = Omit<SamMask, 'raster'> & { raster: number[] };

interface Cached {
  imageW: number; imageH: number;
  components: CircuitComponent[];
  wireMasks: SerialMask[];
  componentMasks: Array<[string, SerialMask]>;
}

async function build(): Promise<Cached> {
  const buf = readFileSync(`public/samples/${sample}.png`);
  const meta = await sharp(buf).metadata();
  const imageW = meta.width!, imageH = meta.height!;
  const dataUrl = `data:image/png;base64,${buf.toString('base64')}`;

  const reading = await readSketch(dataUrl);
  if (!reading) throw new Error('no reading');

  let components: CircuitComponent[] = reading.components.map((c, i) => {
    const bb = c.bbox_permille;
    return {
      id: c.id || `X${i + 1}`,
      type: normaliseType(c.type),
      value: c.value ?? null,
      unit: (c.unit as CircuitComponent['unit']) ?? null,
      orientation: c.orientation ?? null,
      bbox: Array.isArray(bb) && bb.length === 4
        ? [bb[0] / 1000 * imageW, bb[1] / 1000 * imageH, bb[2] / 1000 * imageW, bb[3] / 1000 * imageH]
        : null,
      mask_id: null,
      confidence: c.confidence ?? 0.6,
      pins: [...PINS[normaliseType(c.type)]],
    } as CircuitComponent;
  });

  const boxObjects = components.map((c, i) => ({ c, i })).filter((x) => x.c.bbox).map(({ c, i }) => {
    const [x, y, w, h] = c.bbox!;
    const padX = Math.max(8, w * 0.22), padY = Math.max(8, h * 0.22);
    const left = Math.max(0, Math.round(x - padX)), top = Math.max(0, Math.round(y - padY));
    return { id: i, box: { left, top, right: Math.min(imageW, Math.round(x + w + padX)), bottom: Math.min(imageH, Math.round(y + h + padY)) } };
  });

  const [boxRes, conceptRes] = await Promise.all([
    segmentByBoxes(dataUrl, { width: imageW, height: imageH }, boxObjects),
    segmentConcepts(dataUrl, [...DEFAULT_WIRE_CONCEPTS]),
  ]);
  const byId = new Map(boxRes.masks.map((m) => [String(m.objectId ?? ''), m]));
  components = components.map((c, i) => {
    const m = byId.get(String(i));
    return m ? { ...c, bbox: [m.bbox[0], m.bbox[1], m.bbox[2] - m.bbox[0], m.bbox[3] - m.bbox[1]] as [number, number, number, number], mask_id: m.mask_id } : c;
  });

  const wireMasks = conceptRes.flatMap((r) => r.masks).filter((m) => !isPageFurniture(m, imageW, imageH));
  const componentMasks: Array<[string, SerialMask]> = [];
  components.forEach((c, i) => {
    const m = byId.get(String(i));
    if (m) componentMasks.push([c.id, { ...m, raster: Array.from(m.raster) }]);
  });
  return {
    imageW, imageH, components,
    wireMasks: wireMasks.map((m) => ({ ...m, raster: Array.from(m.raster) })),
    componentMasks,
  };
}

async function main() {
  mkdirSync(CACHE_DIR, { recursive: true });
  let cached: Cached;
  if (!refresh && existsSync(cachePath)) {
    cached = JSON.parse(readFileSync(cachePath, 'utf8'));
    console.log(`(cached ${cachePath})`);
  } else {
    cached = await build();
    writeFileSync(cachePath, JSON.stringify(cached));
    console.log(`(fetched and cached ${cachePath})`);
  }

  const wireMasks: SamMask[] = cached.wireMasks.map((m) => ({ ...m, raster: Uint8Array.from(m.raster) }));
  const { imageW, imageH, components } = cached;

  console.log(`\nimage ${imageW}x${imageH}, ${components.length} components, ${wireMasks.length} wire masks`);
  for (const c of components) {
    console.log(`  ${c.id} ${c.type} orient=${c.orientation} bbox=${c.bbox?.map(Math.round)}`);
  }
  for (const m of wireMasks) {
    console.log(`  wire mask ${m.mask_id}: bbox=${m.bbox} ${m.w}x${m.h} px=${m.raster.reduce((a, b) => a + b, 0)}`);
  }

  const raw = buildWireGrid(wireMasks, imageW, imageH);
  console.log(`\nraw grid ${raw.w}x${raw.h} scale=${raw.scale.toFixed(3)} wirePx=${raw.data.reduce((a, b) => a + b, 0)} regions=${labelRegions(raw).count}`);
  // The grid the trace really walks.
  const componentMasks = new Map<string, SamMask>(
    (cached.componentMasks ?? []).map(([id, m]) => [id, { ...m, raster: Uint8Array.from(m.raster) }]),
  );
  const { grid } = buildTraceGrid(components, wireMasks, imageW, imageH, componentMasks);
  console.log(`traced grid wirePx=${grid.data.reduce((a, b) => a + b, 0)} regions=${labelRegions(grid).count}`);

  console.log('\npin anchors:');
  for (const c of components) {
    for (const a of pinAnchors(c)) console.log(`  ${a.ref.padEnd(14)} at ${Math.round(a.x)},${Math.round(a.y)} dir=${a.dx},${a.dy}`);
  }

  // ASCII map around each anchor, on the same grid the trace labels.
  const { labels } = labelRegions(grid);
  console.log('\nlabelled grid around each anchor (#=wire, .=empty, @=anchor):');
  for (const c of components) {
    for (const a of pinAnchors(c)) {
      const gx = Math.round(a.x * grid.scale);
      const gy = Math.round(a.y * grid.scale);
      console.log(`  ${a.ref} grid=${gx},${gy} dir=${a.dx},${a.dy}`);
      for (let dy = -6; dy <= 6; dy++) {
        let row = '    ';
        for (let dx = -34; dx <= 34; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (dx === 0 && dy === 0) { row += '@'; continue; }
          if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) { row += ' '; continue; }
          row += labels[ny * grid.w + nx] ? '#' : '.';
        }
        console.log(row);
      }
    }
  }

  const result = traceNets(components, wireMasks, imageW, imageH, componentMasks);
  console.log(`\ntrace: coverage=${(result.coverage * 100).toFixed(0)}% regions=${result.regions} nets=${result.nets.length}`);
  for (const n of result.nets) console.log(`  ${n.id}: ${n.pins.join(', ')}`);
  if (result.floating.length) console.log(`  floating: ${result.floating.join(', ')}`);
  console.log('  per-pin region:', JSON.stringify(result.assignments));
}
void main();
