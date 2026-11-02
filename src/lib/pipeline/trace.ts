/**
 * Deterministic connectivity recovery from SAM's wire masks.
 *
 * This is the stage every published sketch-to-netlist system had to train a
 * custom detector for, and it is the one thing we refuse to ask a language model
 * to guess. Given a pixel-accurate mask of the drawn lines, connectivity is not a
 * judgement call any more — it is a connected-components problem:
 *
 *   1. rasterise every wire mask into one binary grid;
 *   2. punch out the component symbols, so a symbol separates the lines it joins
 *      instead of bridging them;
 *   3. close pencil gaps with a small dilation;
 *   4. label the connected regions;
 *   5. place each component's pins geometrically and attach each one to the
 *      region it touches.
 *
 * Pins that land in the same region are the same electrical node. Nothing here
 * is probabilistic, so the same sketch always yields the same netlist, and when a
 * pin touches nothing we can say so rather than inventing a wire.
 */

import type { CircuitComponent, Net } from '../types';
import type { SamMask } from '../meta/sam';

/** Working resolution for the trace. Big enough for thin pencil lines, cheap to label. */
const GRID_MAX = 640;
/** Pencil gaps up to this many working pixels are bridged. */
const DILATE = 2;
/** How far from a pin anchor we look for a wire, as a fraction of the grid's long edge. */
const SEARCH_FRAC = 0.045;

export interface Grid {
  data: Uint8Array;
  w: number;
  h: number;
  scale: number;
}

export interface PinAnchor {
  ref: string;
  /** Image-space pixel position. */
  x: number;
  y: number;
}

export interface TraceResult {
  nets: Net[];
  /** Pin refs that touched no wire region. */
  floating: string[];
  /** Fraction of pins that found a region. Drives connectivity confidence. */
  coverage: number;
  anchors: PinAnchor[];
  /** Number of distinct wire regions found. */
  regions: number;
  debug: { gridW: number; gridH: number; wirePixels: number };
}

// ─────────────────────────────────────────────────────────────── rasterising

export function buildWireGrid(masks: SamMask[], imageW: number, imageH: number): Grid {
  const scale = Math.min(1, GRID_MAX / Math.max(imageW, imageH));
  const w = Math.max(1, Math.round(imageW * scale));
  const h = Math.max(1, Math.round(imageH * scale));
  const data = new Uint8Array(w * h);

  for (const m of masks) {
    const [left, top] = m.bbox;
    for (let my = 0; my < m.h; my++) {
      for (let mx = 0; mx < m.w; mx++) {
        if (!m.raster[my * m.w + mx]) continue;
        const gx = Math.round((left + mx) * scale);
        const gy = Math.round((top + my) * scale);
        if (gx < 0 || gy < 0 || gx >= w || gy >= h) continue;
        data[gy * w + gx] = 1;
      }
    }
  }
  return { data, w, h, scale };
}

/** Zeroes a rectangle, shrunk by `inset` so the leads at its edge survive. */
function punchOut(grid: Grid, bbox: [number, number, number, number], inset: number) {
  const [x, y, bw, bh] = bbox;
  const x0 = Math.max(0, Math.round((x + inset) * grid.scale));
  const y0 = Math.max(0, Math.round((y + inset) * grid.scale));
  const x1 = Math.min(grid.w - 1, Math.round((x + bw - inset) * grid.scale));
  const y1 = Math.min(grid.h - 1, Math.round((y + bh - inset) * grid.scale));
  for (let yy = y0; yy <= y1; yy++) {
    for (let xx = x0; xx <= x1; xx++) grid.data[yy * grid.w + xx] = 0;
  }
}

function dilate(grid: Grid, radius: number): Grid {
  if (radius <= 0) return grid;
  let cur = grid.data;
  for (let pass = 0; pass < radius; pass++) {
    const next = new Uint8Array(cur.length);
    for (let y = 0; y < grid.h; y++) {
      for (let x = 0; x < grid.w; x++) {
        if (!cur[y * grid.w + x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
            next[ny * grid.w + nx] = 1;
          }
        }
      }
    }
    cur = next;
  }
  return { ...grid, data: cur };
}

/** 8-connected labelling. Returns a label per pixel, 0 for background. */
export function labelRegions(grid: Grid): { labels: Int32Array; count: number } {
  const labels = new Int32Array(grid.w * grid.h);
  let count = 0;
  const stack: number[] = [];
  for (let i = 0; i < labels.length; i++) {
    if (!grid.data[i] || labels[i]) continue;
    count++;
    stack.push(i);
    labels[i] = count;
    while (stack.length) {
      const p = stack.pop()!;
      const px = p % grid.w;
      const py = (p - px) / grid.w;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = px + dx, ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
          const q = ny * grid.w + nx;
          if (grid.data[q] && !labels[q]) { labels[q] = count; stack.push(q); }
        }
      }
    }
  }
  return { labels, count };
}

// ─────────────────────────────────────────────────────────────── pin geometry

/**
 * Places a component's pins on its bounding box.
 *
 * A two-terminal symbol has its leads at the ends of its long axis; which end is
 * which comes from the orientation the vision stage reported. A three-terminal
 * symbol gets its control pin on the long side. This is geometry, not guesswork:
 * the box came from SAM, so it is tight around the symbol that was actually drawn.
 */
export function pinAnchors(c: CircuitComponent): PinAnchor[] {
  if (!c.bbox) return [];
  const [x, y, w, h] = c.bbox;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const horizontal = w >= h;
  const ends: Record<'start' | 'end', { x: number; y: number }> = horizontal
    ? { start: { x, y: cy }, end: { x: x + w, y: cy } }
    : { start: { x: cx, y }, end: { x: cx, y: y + h } };

  const o = (c.orientation ?? '').toLowerCase();
  /** Which geometric end carries the first (positive) pin. */
  const firstAtStart = horizontal
    ? !(o.includes('_right'))
    : !(o.includes('_down'));

  const ref = (pin: string) => `${c.id}.${pin}`;
  const two = (a: string, b: string): PinAnchor[] => [
    { ref: ref(a), ...(firstAtStart ? ends.start : ends.end) },
    { ref: ref(b), ...(firstAtStart ? ends.end : ends.start) },
  ];

  switch (c.type) {
    case 'resistor': case 'capacitor': case 'switch': case 'inductor':
    case 'crystal': case 'motor':
      return two(c.pins[0], c.pins[1]);
    case 'led': case 'diode': return two('anode', 'cathode');
    case 'battery': case 'capacitor_electrolytic': case 'buzzer': return two('pos', 'neg');
    case 'ground': return [{ ref: ref('gnd'), x: cx, y: y }];
    case 'junction': return [{ ref: ref('a'), x: cx, y: cy }];
    case 'potentiometer': {
      const [a, b] = two('a', 'b');
      return [a, b, { ref: ref('wiper'), x: horizontal ? cx : x, y: horizontal ? y : cy }];
    }
    case 'transistor': {
      // Collector and emitter at the ends of the long axis, base on the side.
      const [coll, emit] = two('collector', 'emitter');
      return [coll, emit, { ref: ref('base'), x: horizontal ? cx : x, y: horizontal ? y + h : cy }];
    }
    case 'ic': case 'header': {
      // Pins down both long sides, evenly spaced.
      const out: PinAnchor[] = [];
      const per = Math.max(1, Math.ceil(c.pins.length / 2));
      c.pins.forEach((pin, i) => {
        const side = i < per ? 0 : 1;
        const k = (i % per + 0.5) / per;
        out.push(horizontal
          ? { ref: ref(pin), x: x + w * k, y: side ? y : y + h }
          : { ref: ref(pin), x: side ? x : x + w, y: y + h * k });
      });
      return out;
    }
    default: return two(c.pins[0], c.pins[1] ?? c.pins[0]);
  }
}

// ─────────────────────────────────────────────────────────────── the trace

export function traceNets(
  components: CircuitComponent[],
  wireMasks: SamMask[],
  imageW: number,
  imageH: number,
): TraceResult {
  const base = buildWireGrid(wireMasks, imageW, imageH);
  const wirePixelsRaw = base.data.reduce((a, b) => a + b, 0);

  // Punch out each symbol so it separates the lines it joins. The inset keeps the
  // few pixels of lead at the box edge, which is where the pins attach.
  const punched: Grid = { ...base, data: Uint8Array.from(base.data) };
  for (const c of components) {
    if (!c.bbox || c.type === 'junction') continue;
    const inset = Math.max(1, Math.min(c.bbox[2], c.bbox[3]) * 0.12);
    punchOut(punched, c.bbox, inset);
  }

  const grid = dilate(punched, DILATE);
  const { labels, count } = labelRegions(grid);

  const anchors = components.flatMap(pinAnchors);
  const radius = Math.max(4, Math.round(Math.max(grid.w, grid.h) * SEARCH_FRAC));

  /** The nearest labelled region to an image-space point, searched outward. */
  const regionAt = (px: number, py: number): number => {
    const gx = Math.round(px * grid.scale);
    const gy = Math.round(py * grid.scale);
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          // Only the ring at distance r, so the first hit is the nearest.
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
          const l = labels[ny * grid.w + nx];
          if (l) return l;
        }
      }
    }
    return 0;
  };

  const byRegion = new Map<number, string[]>();
  const floating: string[] = [];
  for (const a of anchors) {
    const region = regionAt(a.x, a.y);
    if (!region) { floating.push(a.ref); continue; }
    byRegion.set(region, [...(byRegion.get(region) ?? []), a.ref]);
  }

  // A region holding only one pin is not a connection; that pin is floating.
  const nets: Net[] = [];
  let n = 0;
  for (const [, pins] of [...byRegion.entries()].sort((a, b) => a[0] - b[0])) {
    if (pins.length < 2) { floating.push(...pins); continue; }
    nets.push({ id: `T${++n}`, pins: [...pins].sort(), source: 'mask_trace' });
  }

  const assigned = anchors.length - floating.length;
  return {
    nets,
    floating,
    coverage: anchors.length ? assigned / anchors.length : 0,
    anchors,
    regions: count,
    debug: { gridW: grid.w, gridH: grid.h, wirePixels: wirePixelsRaw },
  };
}

/**
 * Marks the net that carries a ground symbol, or failing that the one carrying
 * the battery's negative terminal.
 */
export function markGround(nets: Net[], components: CircuitComponent[]): Net[] {
  const groundPins = new Set(components.filter((c) => c.type === 'ground').map((c) => `${c.id}.gnd`));
  const negPins = new Set(components.filter((c) => c.type === 'battery').map((c) => `${c.id}.neg`));
  let marked = false;
  const out = nets.map((net) => {
    if (!marked && net.pins.some((p) => groundPins.has(p))) { marked = true; return { ...net, is_ground: true }; }
    return net;
  });
  if (marked) return out;
  for (const net of out) {
    if (net.pins.some((p) => negPins.has(p))) { net.is_ground = true; break; }
  }
  return out;
}
