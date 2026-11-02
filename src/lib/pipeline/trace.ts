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
/**
 * How far a lead is followed outward looking for its wire, as a fraction of the
 * grid's long edge. This is generous because the gap between a drawn symbol and
 * the wire meeting it is often substantial — on the bundled samples it runs to
 * 70 source pixels — but the search is a narrow cone along the lead's own
 * direction, so distance does not buy false positives the way a wide disc would.
 */
const RAY_FRAC = 0.16;
/** Fallback isotropic radius, for pins with no meaningful outward direction. */
const DISC_FRAC = 0.05;

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
  /**
   * Unit vector pointing away from the body, along which the lead leaves. The
   * wire this pin belongs to is searched for in this direction.
   */
  dx: number;
  dy: number;
  /**
   * Half the width of the body edge this lead leaves from, in source pixels,
   * measured perpendicular to the direction. The search sweeps this whole edge,
   * because a lead leaves somewhere along it and not necessarily from its
   * midpoint — an LED's emission arrows push the mask's centre well off the
   * stroke the wire actually meets.
   */
  halfEdge: number;
}

export interface TraceResult {
  nets: Net[];
  /** Pin refs that touched no wire region. */
  floating: string[];
  /** Fraction of pins that found a region. Drives connectivity confidence. */
  coverage: number;
  anchors: PinAnchor[];
  /** Which wire region each pin attached to, 0 for none. Diagnostics. */
  assignments: Record<string, number>;
  /** Number of distinct wire regions found. */
  regions: number;
  /** Components whose pin axis was corrected because both leads shared a region. */
  axisCorrected: string[];
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

/** A small outward margin on the punched rectangle, in source pixels. */
const PUNCH_MARGIN = 3;
/** Working-grid radius by which a component's own mask is grown before removal. */
const MASK_PUNCH_RADIUS = 2;

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

/** Zeroes the pixels of a segmentation mask, grown by `radius` working pixels. */
function punchMask(grid: Grid, mask: SamMask, radius: number) {
  const [left, top] = mask.bbox;
  for (let my = 0; my < mask.h; my++) {
    for (let mx = 0; mx < mask.w; mx++) {
      if (!mask.raster[my * mask.w + mx]) continue;
      const gx = Math.round((left + mx) * grid.scale);
      const gy = Math.round((top + my) * grid.scale);
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = gx + dx, ny = gy + dy;
          if (nx < 0 || ny < 0 || nx >= grid.w || ny >= grid.h) continue;
          grid.data[ny * grid.w + nx] = 0;
        }
      }
    }
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

  /*
   * Which way the part lies.
   *
   * The reported orientation decides this when there is one, because it is a
   * statement about the drawing: "anode_up" means the device is wired top to
   * bottom whatever shape its bounding box happens to be. Falling back to the
   * box's aspect ratio gets an LED wrong, since the emission arrows beside the
   * triangle make a vertically-wired symbol wider than it is tall.
   */
  const o = (c.orientation ?? '').toLowerCase();
  const vertical = /_(up|down)$/.test(o) ? true : /_(left|right)$/.test(o) ? false : h > w;
  const horizontal = !vertical;

  const ends: Record<'start' | 'end', { x: number; y: number }> = horizontal
    ? { start: { x, y: cy }, end: { x: x + w, y: cy } }
    : { start: { x: cx, y }, end: { x: cx, y: y + h } };
  const dirs: Record<'start' | 'end', { dx: number; dy: number }> = horizontal
    ? { start: { dx: -1, dy: 0 }, end: { dx: 1, dy: 0 } }
    : { start: { dx: 0, dy: -1 }, end: { dx: 0, dy: 1 } };
  /** The edge a lead leaves from runs across the body's other dimension. */
  const endEdge = (horizontal ? h : w) / 2;

  /** Which geometric end carries the first (positive) pin. */
  const firstAtStart = horizontal ? !o.includes('_right') : !o.includes('_down');

  const ref = (pin: string) => `${c.id}.${pin}`;
  const at = (pin: string, which: 'start' | 'end'): PinAnchor => ({
    ref: ref(pin), ...ends[which], ...dirs[which], halfEdge: endEdge,
  });
  const two = (a: string, b: string): PinAnchor[] => [
    at(a, firstAtStart ? 'start' : 'end'),
    at(b, firstAtStart ? 'end' : 'start'),
  ];
  /** A side pin leaves perpendicular to the body's axis, from a narrower edge. */
  const side = (pin: string): PinAnchor => (horizontal
    ? { ref: ref(pin), x: cx, y: y + h, dx: 0, dy: 1, halfEdge: w / 4 }
    : { ref: ref(pin), x, y: cy, dx: -1, dy: 0, halfEdge: h / 4 });

  switch (c.type) {
    case 'resistor': case 'capacitor': case 'switch': case 'inductor':
    case 'crystal': case 'motor':
      return two(c.pins[0], c.pins[1]);
    case 'led': case 'diode': return two('anode', 'cathode');
    case 'battery': case 'capacitor_electrolytic': case 'buzzer': return two('pos', 'neg');
    case 'ground': return [{ ref: ref('gnd'), x: cx, y, dx: 0, dy: -1, halfEdge: w / 2 }];
    // A junction has no direction; it is found by the fallback disc search.
    case 'junction': return [{ ref: ref('a'), x: cx, y: cy, dx: 0, dy: 0, halfEdge: 0 }];
    case 'potentiometer': {
      const [a, b] = two('a', 'b');
      return [a, b, side('wiper')];
    }
    case 'transistor': {
      const [coll, emit] = two('collector', 'emitter');
      return [coll, emit, side('base')];
    }
    case 'ic': case 'header': {
      // Pins down both long sides, evenly spaced, each leaving outward.
      const out: PinAnchor[] = [];
      const per = Math.max(1, Math.ceil(c.pins.length / 2));
      c.pins.forEach((pin, i) => {
        const first = i < per;
        const k = (i % per + 0.5) / per;
        // One pin among many, so its edge is a single pitch, not the whole side.
        const pitch = (horizontal ? w : h) / (per * 2);
        out.push(horizontal
          ? { ref: ref(pin), x: x + w * k, y: first ? y : y + h, dx: 0, dy: first ? -1 : 1, halfEdge: pitch }
          : { ref: ref(pin), x: first ? x : x + w, y: y + h * k, dx: first ? -1 : 1, dy: 0, halfEdge: pitch });
      });
      return out;
    }
    default: return two(c.pins[0], c.pins[1] ?? c.pins[0]);
  }
}

// ─────────────────────────────────────────────────────────────── the trace

/**
 * The grid the trace actually walks: every wire mask rasterised, each component
 * symbol punched out of it, then dilated to close pencil gaps.
 *
 * Exported so the diagnostic harness can look at exactly what the trace sees,
 * rather than at an earlier version of it.
 */
export function buildTraceGrid(
  components: CircuitComponent[],
  wireMasks: SamMask[],
  imageW: number,
  imageH: number,
  /** Each component's own segmentation mask, by component id, when available. */
  componentMasks: Map<string, SamMask> = new Map(),
): { grid: Grid; wirePixelsRaw: number } {
  const base = buildWireGrid(wireMasks, imageW, imageH);
  const wirePixelsRaw = base.data.reduce((a, b) => a + b, 0);

  /*
   * Punch each symbol out of the wire grid.
   *
   * This serves two purposes at once. It makes a symbol separate the lines it
   * joins, so the regions either side of a resistor are distinct nets. And it
   * removes the symbol's own strokes, which matters because asked for the drawn
   * lines on a pencil sketch SAM quite reasonably returns a resistor's zigzag —
   * that is what a resistor is drawn as. Left in, the zigzag becomes a region
   * that captures the resistor's own pin before the search can reach the wire.
   *
   * The component's own mask is used where there is one, because it is the exact
   * set of pixels SAM called this symbol; its bounding box is punched too, to
   * cover any stroke the mask clipped.
   */
  const punched: Grid = { ...base, data: Uint8Array.from(base.data) };
  for (const c of components) {
    if (c.type === 'junction') continue;
    const mask = componentMasks.get(c.id);
    if (mask) punchMask(punched, mask, MASK_PUNCH_RADIUS);
    if (c.bbox) punchOut(punched, c.bbox, -PUNCH_MARGIN);
  }

  return { grid: dilate(punched, DILATE), wirePixelsRaw };
}

export function traceNets(
  components: CircuitComponent[],
  wireMasks: SamMask[],
  imageW: number,
  imageH: number,
  componentMasks: Map<string, SamMask> = new Map(),
): TraceResult {
  const { grid, wirePixelsRaw } = buildTraceGrid(components, wireMasks, imageW, imageH, componentMasks);
  const { labels, count } = labelRegions(grid);

  const anchors = components.flatMap(pinAnchors);
  const longEdge = Math.max(grid.w, grid.h);
  const rayLength = Math.max(6, Math.round(longEdge * RAY_FRAC));
  const discRadius = Math.max(4, Math.round(longEdge * DISC_FRAC));

  const labelAt = (gx: number, gy: number): number => {
    if (gx < 0 || gy < 0 || gx >= grid.w || gy >= grid.h) return 0;
    return labels[gy * grid.w + gx];
  };

  /**
   * Sweeps outward from the edge a lead leaves, looking for the wire it joins.
   *
   * The search is a band: as wide as the body edge the lead leaves from, swept
   * along the outward normal. Width comes from the symbol's own geometry rather
   * than from a guess, so an off-centre lead is still found, and because the
   * band only ever extends along the normal it cannot reach sideways and claim
   * an unrelated net running parallel — which an isotropic search of the same
   * reach would do. The nearest hit wins, so the first wire encountered is the
   * one the lead meets.
   */
  const regionAlong = (a: PinAnchor): number => {
    if (a.dx === 0 && a.dy === 0) return 0;
    const gx = a.x * grid.scale;
    const gy = a.y * grid.scale;
    // Perpendicular to the lead direction.
    const px = -a.dy;
    const py = a.dx;
    const halfEdge = a.halfEdge * grid.scale;
    for (let t = 0; t <= rayLength; t++) {
      // A little splay with distance, for leads that bend away from the body.
      const halfWidth = Math.max(1, halfEdge + t * 0.1);
      for (let k = 0; k <= halfWidth; k++) {
        for (const sign of k === 0 ? [0] : [-1, 1]) {
          const nx = Math.round(gx + a.dx * t + px * k * sign);
          const ny = Math.round(gy + a.dy * t + py * k * sign);
          const l = labelAt(nx, ny);
          if (l) return l;
        }
      }
    }
    return 0;
  };

  /** The nearest labelled region to a point, searched outward in rings. */
  const regionAt = (ax: number, ay: number, radius: number): number => {
    const gx = Math.round(ax * grid.scale);
    const gy = Math.round(ay * grid.scale);
    for (let r = 0; r <= radius; r++) {
      for (let dy = -r; dy <= r; dy++) {
        for (let dx = -r; dx <= r; dx++) {
          // Only the ring at distance r, so the first hit is the nearest.
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
          const l = labelAt(gx + dx, gy + dy);
          if (l) return l;
        }
      }
    }
    return 0;
  };

  // Along the lead first; the disc is only for pins with no direction, or a
  // lead whose wire genuinely starts off to one side.
  const resolve = (a: PinAnchor): number => regionAlong(a) || regionAt(a.x, a.y, discRadius);

  const assignments: Record<string, number> = {};
  const anchorByRef = new Map(anchors.map((a) => [a.ref, a]));
  for (const a of anchors) assignments[a.ref] = resolve(a);

  /*
   * Axis correction for two-terminal parts.
   *
   * When a component reports no orientation we guess its axis from its bounding
   * box, and that guess is wrong whenever the box is wider than it is tall but
   * the part is wired top to bottom — a capacitor's two plates, for instance.
   * The symptom is unmistakable: both leads land on the same wire region, which
   * would mean the component is shorted out by a wire, something a person
   * essentially never draws.
   *
   * So when that happens, the perpendicular axis is tried, and kept only if it
   * resolves to two genuinely different regions. This is a correction with a
   * clear precondition, not a search over possibilities.
   */
  const axisCorrected: string[] = [];
  for (const c of components) {
    if (c.pins.length !== 2 || !c.bbox) continue;
    const [refA, refB] = c.pins.map((p) => `${c.id}.${p}`);
    const a = anchorByRef.get(refA);
    const b = anchorByRef.get(refB);
    if (!a || !b) continue;
    const same = assignments[refA] !== 0 && assignments[refA] === assignments[refB];
    const bothLost = assignments[refA] === 0 && assignments[refB] === 0;
    if (!same && !bothLost) continue;

    const [x, y, w, h] = c.bbox;
    const cx = x + w / 2;
    const cy = y + h / 2;
    const swapped = a.dy === 0
      ? [
          { ...a, x: cx, y, dx: 0, dy: -1, halfEdge: w / 2 },
          { ...b, x: cx, y: y + h, dx: 0, dy: 1, halfEdge: w / 2 },
        ]
      : [
          { ...a, x, y: cy, dx: -1, dy: 0, halfEdge: h / 2 },
          { ...b, x: x + w, y: cy, dx: 1, dy: 0, halfEdge: h / 2 },
        ];
    const ra = resolve(swapped[0]);
    const rb = resolve(swapped[1]);
    if (ra === 0 || rb === 0 || ra === rb) continue;

    assignments[refA] = ra;
    assignments[refB] = rb;
    anchorByRef.set(refA, swapped[0]);
    anchorByRef.set(refB, swapped[1]);
    axisCorrected.push(c.id);
  }

  const byRegion = new Map<number, string[]>();
  const floating: string[] = [];
  for (const ref of Object.keys(assignments)) {
    const region = assignments[ref];
    if (!region) { floating.push(ref); continue; }
    byRegion.set(region, [...(byRegion.get(region) ?? []), ref]);
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
    anchors: [...anchorByRef.values()],
    assignments,
    axisCorrected,
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

/**
 * Fills the gaps the mask walk left, using the model's netlist, without
 * discarding anything the walk established.
 *
 * The all-or-nothing alternative — throw the whole trace away when coverage is
 * imperfect — loses verified connections to repair unverified ones, and SAM's
 * recall varies enough between runs on the same sketch that the threshold
 * decides the outcome more than the drawing does.
 *
 * So the trace keeps authority over structure and the model is consulted only
 * about pins the trace could not place. A floating pin joins the traced net that
 * shares the most pins with the model's net for it; if no traced net overlaps,
 * the model's remaining pins form a net of their own. Each net records which
 * source it came from, so the interface can say which connections were measured
 * and which were inferred.
 */
export function reconcileNets(
  tracedNets: Net[],
  modelNets: Net[],
  floating: string[],
): { nets: Net[]; stillFloating: string[]; inferred: string[] } {
  const nets: Net[] = tracedNets.map((n) => ({ ...n, pins: [...n.pins] }));
  const placed = new Set(nets.flatMap((n) => n.pins));
  const stillFloating: string[] = [];
  const inferred: string[] = [];

  for (const pin of floating) {
    if (placed.has(pin)) continue;
    const modelNet = modelNets.find((n) => n.pins.includes(pin));
    if (!modelNet) { stillFloating.push(pin); continue; }

    let best: { net: Net; overlap: number } | null = null;
    for (const net of nets) {
      const overlap = net.pins.filter((p) => modelNet.pins.includes(p)).length;
      if (overlap > 0 && (!best || overlap > best.overlap)) best = { net, overlap };
    }

    if (best) {
      best.net.pins.push(pin);
      best.net.source = 'mask_trace';
      placed.add(pin);
      inferred.push(pin);
      continue;
    }

    // No traced net to attach to: take the model's net for the pins still loose.
    const fresh = modelNet.pins.filter((p) => !placed.has(p));
    if (fresh.length >= 2) {
      nets.push({ id: `M${nets.length + 1}`, pins: [...fresh], source: 'model' });
      for (const p of fresh) { placed.add(p); inferred.push(p); }
    } else {
      stillFloating.push(pin);
    }
  }

  return {
    nets: nets.map((n, i) => ({ ...n, id: `N${i + 1}`, pins: [...n.pins].sort() })),
    stillFloating,
    inferred,
  };
}
