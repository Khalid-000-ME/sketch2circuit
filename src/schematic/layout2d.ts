/**
 * Schematic placement.
 *
 * Same idea as the 3D layout — a seeded force-directed relaxation over the net
 * graph — but with the constraints a schematic actually has: every position
 * lands on the grid, and every part is axis-aligned, because a schematic read at
 * a glance is one where wires are horizontal or vertical and nothing is at 37°.
 *
 * No three.js here: this view must not pull a WebGL renderer into the bundle to
 * draw lines.
 */

import type { CircuitComponent, Net } from '@/lib/types';
import { GRID, symbolFor } from './symbols';

export interface Vec { x: number; y: number }

export interface Placement2D {
  id: string;
  position: Vec;
  /** Degrees, one of 0, 90, 180, 270. */
  rotation: number;
  /** Half-extents including leads. */
  half: readonly [number, number];
  /** Half-extents of the drawn body alone, which is what labels are placed from. */
  bodyHalf: readonly [number, number];
}

export interface Layout2D {
  placements: Map<string, Placement2D>;
  /**
   * Whether nets meet outward of every lead (true) or at the median of their
   * pins (false). Part of the layout, because the arrangement is only good for
   * the routing it was scored with.
   */
  outwardHubs?: boolean;
  bounds: { minX: number; minY: number; maxX: number; maxY: number };
}

const ITERATIONS = 460;
const IDEAL_EDGE = GRID * 7;
const REPULSION = GRID * GRID * 26;

function seeded(text: string) {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

const snap = (v: number) => Math.round(v / GRID) * GRID;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

export function layoutSchematic(components: CircuitComponent[], nets: Net[]): Layout2D {
  const ids = components.map((c) => c.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const rand = seeded(ids.join('|'));

  const defs = components.map((c) => symbolFor(c));
  // Radius for repulsion: the part's longest half-extent plus clearance.
  const radius = defs.map((d) => Math.max(d.half[0], d.half[1]) + GRID * 1.4);

  const pos: Vec[] = ids.map((_, i) => {
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = GRID * 5 + rand() * GRID * 3;
    return { x: Math.cos(a) * r, y: Math.sin(a) * r };
  });

  const edges: Array<[number, number]> = [];
  for (const net of nets) {
    const members = [...new Set(net.pins.map((p) => p.split('.')[0]))]
      .map((id) => index.get(id))
      .filter((i): i is number => i != null);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) edges.push([members[i], members[j]]);
    }
  }

  const force: Vec[] = ids.map(() => ({ x: 0, y: 0 }));
  for (let step = 0; step < ITERATIONS; step++) {
    const cooling = 1 - step / ITERATIONS;
    for (const f of force) { f.x = 0; f.y = 0; }

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = pos[i].x - pos[j].x;
        let dy = pos[i].y - pos[j].y;
        let len = Math.hypot(dx, dy);
        if (len < 1e-4) { dx = (rand() - 0.5) * 2; dy = (rand() - 0.5) * 2; len = Math.hypot(dx, dy); }
        const min = radius[i] + radius[j];
        const mag = REPULSION / (len * len) + (len < min ? (min - len) * 1.5 : 0);
        const ux = (dx / len) * mag, uy = (dy / len) * mag;
        force[i].x += ux; force[i].y += uy;
        force[j].x -= ux; force[j].y -= uy;
      }
    }

    for (const [i, j] of edges) {
      const dx = pos[j].x - pos[i].x;
      const dy = pos[j].y - pos[i].y;
      const len = Math.max(Math.hypot(dx, dy), 1e-4);
      const mag = (len - IDEAL_EDGE) * 0.09;
      const ux = (dx / len) * mag, uy = (dy / len) * mag;
      force[i].x += ux; force[i].y += uy;
      force[j].x -= ux; force[j].y -= uy;
    }

    for (let i = 0; i < n; i++) {
      force[i].x -= pos[i].x * 0.012;
      force[i].y -= pos[i].y * 0.012;
      const cap = GRID * (0.9 * cooling + 0.04);
      const len = Math.hypot(force[i].x, force[i].y);
      if (len > cap) { force[i].x = (force[i].x / len) * cap; force[i].y = (force[i].y / len) * cap; }
      pos[i].x += force[i].x;
      pos[i].y += force[i].y;
    }
  }

  // ── Orientation ───────────────────────────────────────────────────────────
  // A part lies along the line between the things its two leads connect to,
  // snapped to the nearest axis. That is what keeps wires orthogonal: if the
  // part is at 37° then every wire leaving it has to be too.
  const netMembers = new Map(nets.map((net) => [net.id, [...new Set(net.pins.map((p) => p.split('.')[0]))]]));
  const netsOfPin = new Map<string, string[]>();
  for (const net of nets) {
    for (const p of net.pins) netsOfPin.set(p, [...(netsOfPin.get(p) ?? []), net.id]);
  }

  const neighbourCentroid = (compId: string, pin: string): Vec | null => {
    const others = (netsOfPin.get(`${compId}.${pin}`) ?? [])
      .flatMap((netId) => netMembers.get(netId) ?? [])
      .filter((id) => id !== compId)
      .map((id) => index.get(id))
      .filter((i): i is number => i != null);
    if (others.length === 0) return null;
    const c = { x: 0, y: 0 };
    for (const i of others) { c.x += pos[i].x; c.y += pos[i].y; }
    return { x: c.x / others.length, y: c.y / others.length };
  };

  const placements = new Map<string, Placement2D>();
  components.forEach((c, i) => {
    const def = defs[i];
    const pinNames = Object.keys(def.pins);
    let rotation = 0;

    if (pinNames.length >= 2) {
      const a = neighbourCentroid(c.id, pinNames[0]);
      const b = neighbourCentroid(c.id, pinNames[1]);
      if (a && b) {
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        // Local +X runs from the first pin to the second, so the rotation is the
        // axis-snapped bearing of that line.
        if (Math.abs(dx) >= Math.abs(dy)) rotation = dx >= 0 ? 0 : 180;
        else rotation = dy >= 0 ? 90 : 270;
      }
    } else if (c.type === 'ground') {
      rotation = 0;
    }

    placements.set(c.id, {
      id: c.id,
      position: { x: snap(pos[i].x), y: snap(pos[i].y) },
      rotation,
      half: def.half,
      bodyHalf: def.bodyHalf,
    });
  });

  /*
   * ── Orientation refinement ───────────────────────────────────────────────
   *
   * The bearing between neighbour centroids picks the right axis but not always
   * the right end: on a net joining five leads the centroid sits in the middle of
   * all of them and says nothing about which side of *this* part its node is on.
   * A part turned the wrong way sends each lead away from the node it belongs to,
   * and the router then has to double back, leaving a spur sticking out past the
   * component.
   *
   * So each two-terminal part is scored against its own flip: whichever rotation
   * puts its leads nearer the nodes they actually join is kept. The nodes are the
   * same hubs the router will use, so this optimises exactly what is drawn.
   */
  const netOfPin = new Map<string, Net>();
  for (const net of nets) for (const pin of net.pins) netOfPin.set(pin, net);

  const hubOf = (net: Net): Vec | null => {
    const points = net.pins
      .map((ref) => {
        const id = ref.slice(0, ref.lastIndexOf('.'));
        const pin = ref.slice(ref.lastIndexOf('.') + 1);
        const place = placements.get(id);
        const i = index.get(id);
        if (!place || i == null) return null;
        const local = defs[i].pins[pin];
        return local ? pinPosition(place, local) : null;
      })
      .filter((p): p is Vec => p != null);
    if (points.length === 0) return null;
    return {
      x: snap(median(points.map((p) => p.x))),
      y: snap(median(points.map((p) => p.y))),
    };
  };

  /*
   * ── Positional refinement ────────────────────────────────────────────────
   *
   * A two-terminal part belongs *between* the two nodes it joins. The relaxation
   * does not know that — it only knows that connected things attract — so it can
   * leave a decoupling capacitor sitting above both of the rails it bridges,
   * where every wire leaving it has to double back through its own body.
   *
   * This pulls each part toward the midpoint of its two nodes, but only into a
   * space that is actually free: a move that would overlap another part is
   * declined rather than forced, so the guarantee that nothing collides survives.
   */
  const occupies = (id: string, at: Vec, rotation: number, i: number): boolean => {
    const def = defs[i];
    const ext = rotation % 180 === 0 ? def.half : ([def.half[1], def.half[0]] as const);
    for (const [otherId, other] of placements) {
      if (otherId === id) continue;
      const j = index.get(otherId)!;
      const odef = defs[j];
      const oext = other.rotation % 180 === 0 ? odef.half : ([odef.half[1], odef.half[0]] as const);
      const gap = GRID * 0.75;
      if (Math.abs(at.x - other.position.x) < ext[0] + oext[0] + gap
        && Math.abs(at.y - other.position.y) < ext[1] + oext[1] + gap) return true;
    }
    return false;
  };

  for (let pass = 0; pass < 3; pass++) {
    let moved = false;
    components.forEach((c, i) => {
      const def = defs[i];
      const pinNames = Object.keys(def.pins);
      if (pinNames.length !== 2) return;
      const place = placements.get(c.id)!;

      const hubs = pinNames
        .map((pin) => netOfPin.get(`${c.id}.${pin}`))
        .map((net) => (net ? hubOf(net) : null))
        .filter((h): h is Vec => h != null);
      if (hubs.length !== 2) return;

      const target: Vec = {
        x: snap((hubs[0].x + hubs[1].x) / 2),
        y: snap((hubs[0].y + hubs[1].y) / 2),
      };
      if (target.x === place.position.x && target.y === place.position.y) return;
      if (occupies(c.id, target, place.rotation, i)) return;
      placements.set(c.id, { ...place, position: target });
      moved = true;
    });
    if (!moved) break;
  }

  for (let pass = 0; pass < 2; pass++) {
    let changed = false;
    components.forEach((c, i) => {
      const def = defs[i];
      const pinNames = Object.keys(def.pins);
      if (pinNames.length !== 2) return;
      const place = placements.get(c.id)!;

      const cost = (rotation: number) => {
        let total = 0;
        for (const pin of pinNames) {
          const net = netOfPin.get(`${c.id}.${pin}`);
          if (!net) continue;
          const hub = hubOf(net);
          if (!hub) continue;
          const at = pinPosition({ ...place, rotation }, def.pins[pin]);
          total += Math.abs(at.x - hub.x) + Math.abs(at.y - hub.y);
        }
        return total;
      };

      const flipped = (place.rotation + 180) % 360;
      if (cost(flipped) < cost(place.rotation) - 1) {
        placements.set(c.id, { ...place, rotation: flipped });
        changed = true;
      }
    });
    if (!changed) break;
  }

  return { placements, bounds: boundsOf(components, placements) };
}

/** The drawing's extent, including every pin so nothing is clipped. */
export function boundsOf(
  components: CircuitComponent[],
  placements: Map<string, Placement2D>,
): Layout2D['bounds'] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const c of components) {
    const p = placements.get(c.id);
    if (!p) continue;
    const def = symbolFor(c);
    const corners: Vec[] = [
      ...Object.values(def.pins).map(([x, y]) => rotate({ x, y }, p.rotation)),
      rotate({ x: def.half[0], y: def.half[1] }, p.rotation),
      rotate({ x: -def.half[0], y: -def.half[1] }, p.rotation),
      rotate({ x: def.half[0], y: -def.half[1] }, p.rotation),
      rotate({ x: -def.half[0], y: def.half[1] }, p.rotation),
    ];
    for (const corner of corners) {
      minX = Math.min(minX, p.position.x + corner.x);
      maxX = Math.max(maxX, p.position.x + corner.x);
      minY = Math.min(minY, p.position.y + corner.y);
      maxY = Math.max(maxY, p.position.y + corner.y);
    }
  }
  if (!Number.isFinite(minX)) { minX = -100; minY = -100; maxX = 100; maxY = 100; }
  return { minX, minY, maxX, maxY };
}

/** Rotates a local offset by a multiple of 90 degrees. */
export function rotate(v: Vec, degrees: number): Vec {
  switch (((degrees % 360) + 360) % 360) {
    case 90: return { x: -v.y, y: v.x };
    case 180: return { x: -v.x, y: -v.y };
    case 270: return { x: v.y, y: -v.x };
    default: return { x: v.x, y: v.y };
  }
}

/** World position of a pin, given its component's placement. */
export function pinPosition(placement: Placement2D, local: readonly [number, number]): Vec {
  const r = rotate({ x: local[0], y: local[1] }, placement.rotation);
  return { x: placement.position.x + r.x, y: placement.position.y + r.y };
}

/** The outward direction a lead leaves in, in world space, axis-aligned. */
export function pinDirection(placement: Placement2D, local: readonly [number, number]): Vec {
  const r = rotate({ x: local[0], y: local[1] }, placement.rotation);
  if (Math.abs(r.x) >= Math.abs(r.y)) return { x: Math.sign(r.x) || 1, y: 0 };
  return { x: 0, y: Math.sign(r.y) || 1 };
}
