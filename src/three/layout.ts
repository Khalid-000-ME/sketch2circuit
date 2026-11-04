/**
 * Net graph → 3D positions.
 *
 * Positions are computed on the client, never asked of a model: a language model
 * asked for coordinates returns plausible-looking nonsense, while the graph we
 * already have fully determines a readable arrangement.
 *
 * The method is a small force-directed relaxation — components that share a net
 * attract, all components repel, and the result is snapped to a 2.54mm grid so
 * the board reads as a board rather than a cloud. It is seeded deterministically,
 * so the same circuit always lays out the same way and the demo is repeatable.
 */

import * as THREE from 'three';
import type { CircuitComponent, Net } from '@/lib/types';
import { isBoardType } from '@/lib/circuit/boards';

/** The measured half-extents of a built component, in its own local space. */
export interface Extent {
  halfX: number;
  halfZ: number;
  /** Where the geometry's middle sits relative to the part's origin. */
  cx?: number;
  cz?: number;
}

export interface Placement {
  id: string;
  position: THREE.Vector3;
  /** Rotation about Y, aligning the part's long axis with its connections. */
  rotationY: number;
  extent: Extent;
}

/** Where a person put a part: kept exactly, and never moved by the layout. */
export interface Manual {
  x: number;
  z: number;
  rot: number;
}

export interface LayoutResult {
  placements: Map<string, Placement>;
  /** Board extent, with a margin, and where its middle is. */
  board: { width: number; depth: number; cx: number; cz: number };
}

const GRID = 0.254 * 2;
const ITERATIONS = 420;
const IDEAL_EDGE = 2.6;
const REPULSION = 10.5;

/** A deterministic PRNG, so a given circuit always lands in the same place. */
function seeded(seedText: string) {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i++) {
    h ^= seedText.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return () => {
    h ^= h << 13; h ^= h >>> 17; h ^= h << 5;
    return ((h >>> 0) % 100000) / 100000;
  };
}

export function layoutCircuit(
  components: CircuitComponent[],
  nets: Net[],
  extents: Map<string, Extent>,
  manual: Map<string, Manual> = new Map(),
): LayoutResult {
  const ids = components.map((c) => c.id);
  const index = new Map(ids.map((id, i) => [id, i]));
  const n = ids.length;
  const rand = seeded(ids.join('|'));

  const isFixed = ids.map((id) => manual.has(id));
  const pos = ids.map((id, i) => {
    const m = manual.get(id);
    if (m) return new THREE.Vector2(m.x, m.z);
    // Seeded ring start: no two components coincide, and the result is stable.
    const a = (i / Math.max(1, n)) * Math.PI * 2;
    const r = 3 + rand() * 1.5;
    return new THREE.Vector2(Math.cos(a) * r, Math.sin(a) * r);
  });

  // Edges: every pair of components sharing a net.
  const edges: Array<[number, number]> = [];
  for (const net of nets) {
    const members = [...new Set(net.pins.map((p) => p.split('.')[0]))]
      .map((id) => index.get(id))
      .filter((i): i is number => i != null);
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) edges.push([members[i], members[j]]);
    }
  }

  const extentOf = (id: string): Extent => extents.get(id) ?? { halfX: 0.6, halfZ: 0.4 };
  // Repulsion treats each part as a disc of its longest half-extent: conservative,
  // and it is what guarantees no two bodies overlap however they end up rotated.
  const radius = ids.map((id) => Math.max(extentOf(id).halfX, extentOf(id).halfZ) + 0.45);
  const force = ids.map(() => new THREE.Vector2());

  for (let step = 0; step < ITERATIONS; step++) {
    const cooling = 1 - step / ITERATIONS;
    for (const f of force) f.set(0, 0);

    // Repulsion, plus a hard floor so no two parts ever overlap.
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const d = new THREE.Vector2().subVectors(pos[i], pos[j]);
        let len = d.length();
        if (len < 1e-4) { d.set((rand() - 0.5) * 0.1, (rand() - 0.5) * 0.1); len = d.length(); }
        const min = radius[i] + radius[j];
        const mag = REPULSION / (len * len) + (len < min ? (min - len) * 1.4 : 0);
        d.multiplyScalar(mag / len);
        force[i].add(d);
        force[j].sub(d);
      }
    }

    // Attraction along shared nets.
    for (const [i, j] of edges) {
      const d = new THREE.Vector2().subVectors(pos[j], pos[i]);
      const len = Math.max(d.length(), 1e-4);
      const mag = (len - IDEAL_EDGE) * 0.08;
      d.multiplyScalar(mag / len);
      force[i].add(d);
      force[j].sub(d);
    }

    // A weak pull to the origin keeps disconnected islands on the board.
    for (let i = 0; i < n; i++) force[i].addScaledVector(pos[i], -0.012);

    for (let i = 0; i < n; i++) {
      // A part the person placed stays where they put it; the rest arrange around it.
      if (isFixed[i]) continue;
      const f = force[i];
      const cap = 0.6 * cooling + 0.02;
      if (f.length() > cap) f.setLength(cap);
      pos[i].add(f);
    }
  }

  // Orientation: align each part's long axis with the line between the things it
  // connects to, so wires leave its ends rather than crossing its body.
  const netsOfPin = new Map<string, string[]>();
  for (const net of nets) for (const p of net.pins) netsOfPin.set(p, [...(netsOfPin.get(p) ?? []), net.id]);
  const netMembers = new Map(nets.map((net) => [net.id, [...new Set(net.pins.map((p) => p.split('.')[0]))]]));

  const neighbourCentroid = (compId: string, pin: string): THREE.Vector2 | null => {
    const netIds = netsOfPin.get(`${compId}.${pin}`) ?? [];
    const others = netIds
      .flatMap((netId) => netMembers.get(netId) ?? [])
      .filter((id) => id !== compId)
      .map((id) => index.get(id))
      .filter((i): i is number => i != null);
    if (others.length === 0) return null;
    const c = new THREE.Vector2();
    for (const i of others) c.add(pos[i]);
    return c.divideScalar(others.length);
  };

  const placements = new Map<string, Placement>();
  components.forEach((c, i) => {
    let rotationY = 0;
    const [pinA, pinB] = c.pins;
    // A board's first two pins are RESET and 3V3, which say nothing about which
    // way it should face, and a board turned to face its wires would have its
    // headers where its connectors should be.
    if (pinA && pinB && !isBoardType(c.type)) {
      const a = neighbourCentroid(c.id, pinA);
      const b = neighbourCentroid(c.id, pinB);
      if (a && b) {
        const dir = new THREE.Vector2().subVectors(b, a);
        // Local +X maps to world +X; world Z grows "south", hence the negation.
        if (dir.lengthSq() > 1e-6) rotationY = -Math.atan2(dir.y, dir.x);
      }
    }
    const m = manual.get(c.id);
    if (m) rotationY = m.rot;
    const snapped = m
      ? new THREE.Vector2(m.x, m.z)
      : new THREE.Vector2(Math.round(pos[i].x / GRID) * GRID, Math.round(pos[i].y / GRID) * GRID);
    placements.set(c.id, {
      id: c.id,
      position: new THREE.Vector3(snapped.x, 0, snapped.y),
      rotationY,
      extent: extentOf(c.id),
    });
  });

  if (manual.size > 0) settleNewcomers(components, nets, placements, manual);
  separate(placements, new Set(manual.keys()));

  // Recentre on the content: the relaxation drifts, and a board whose parts sit
  // in one corner reads as a mistake even when the topology is right.
  const bounds = { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity };
  for (const p of placements.values()) {
    // Project the part's own half-extents through its rotation, so a long part
    // lying across the board claims board in the direction it actually occupies.
    const c = Math.abs(Math.cos(p.rotationY));
    const s = Math.abs(Math.sin(p.rotationY));
    const dx = c * p.extent.halfX + s * p.extent.halfZ + 0.25;
    const dz = s * p.extent.halfX + c * p.extent.halfZ + 0.25;
    bounds.minX = Math.min(bounds.minX, p.position.x - dx);
    bounds.maxX = Math.max(bounds.maxX, p.position.x + dx);
    bounds.minZ = Math.min(bounds.minZ, p.position.z - dz);
    bounds.maxZ = Math.max(bounds.maxZ, p.position.z + dz);
  }
  const centreX = (bounds.minX + bounds.maxX) / 2;
  const centreZ = (bounds.minZ + bounds.maxZ) / 2;
  // With nothing placed by hand the content is centred on the board. Once a part
  // has been placed, moving everything would move it too, so the board moves to
  // the content instead.
  const recentre = manual.size === 0;
  if (recentre) {
    for (const p of placements.values()) {
      p.position.x -= centreX;
      p.position.z -= centreZ;
    }
  }

  const MARGIN = 1.15;
  return {
    placements,
    board: {
      width: Math.max(4, bounds.maxX - bounds.minX + MARGIN * 2),
      depth: Math.max(3.5, bounds.maxZ - bounds.minZ + MARGIN * 2),
      cx: recentre ? 0 : centreX,
      cz: recentre ? 0 : centreZ,
    },
  };
}

/** World-space position of a pin, given its component's placement. */
export function pinWorldPosition(
  placement: Placement,
  localPin: THREE.Vector3,
): THREE.Vector3 {
  return localPin.clone()
    .applyAxisAngle(new THREE.Vector3(0, 1, 0), placement.rotationY)
    .add(placement.position);
}

const GAP = 0.4;

/** Half-extents of a part's footprint once it is turned. */
export function footprintAt(extent: Extent, rotationY: number, x: number, z: number) {
  return footprint({ id: '', position: new THREE.Vector3(x, 0, z), rotationY, extent });
}

function footprint(p: Placement) {
  const c = Math.abs(Math.cos(p.rotationY));
  const s = Math.abs(Math.sin(p.rotationY));
  const cx = p.extent.cx ?? 0;
  const cz = p.extent.cz ?? 0;
  const r = p.rotationY;
  return {
    dx: c * p.extent.halfX + s * p.extent.halfZ,
    dz: s * p.extent.halfX + c * p.extent.halfZ,
    // The middle of the footprint in the world, which is not the origin for a
    // part whose geometry is built off to one side.
    mx: p.position.x + cx * Math.cos(r) + cz * Math.sin(r),
    mz: p.position.z - cx * Math.sin(r) + cz * Math.cos(r),
  };
}

/**
 * Pushes parts apart until no two footprints overlap.
 *
 * The relaxation keeps parts apart by a round distance, which is a poor fit for a
 * long board beside a small LED: the board is wide, so a disc big enough to clear
 * it wastes the layout, and one small enough to be compact lets parts sit on top
 * of it. This works on the rectangles each part really occupies, moving a pair
 * along whichever axis frees them with the least travel, and snaps back to the
 * grid after each pass so the board still reads as a board.
 */
function separate(placements: Map<string, Placement>, immobile: Set<string>) {
  const list = [...placements.values()];
  for (const p of list) {
    if (immobile.has(p.id)) continue;
    p.position.x = Math.round(p.position.x / GRID) * GRID;
    p.position.z = Math.round(p.position.z / GRID) * GRID;
  }
  for (let pass = 0; pass < 120; pass++) {
    let moved = false;
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const a = list[i];
        const b = list[j];
        const fa = footprint(a);
        const fb = footprint(b);
        const ox = fa.dx + fb.dx + GAP - Math.abs(fa.mx - fb.mx);
        const oz = fa.dz + fb.dz + GAP - Math.abs(fa.mz - fb.mz);
        if (ox <= 0 || oz <= 0) continue;
        const fa0 = immobile.has(a.id), fb0 = immobile.has(b.id);
        if (fa0 && fb0) continue;
        moved = true;
        const axis = ox < oz ? 'x' : 'z';
        // Whole grid steps, so a pushed part is still on the grid and nothing has
        // to be rounded back into its neighbour afterwards.
        const push = Math.ceil((axis === 'x' ? ox : oz) / 2 / GRID) * GRID;
        const sign = (axis === 'x' ? fa.mx <= fb.mx : fa.mz <= fb.mz) ? -1 : 1;
        // A part that cannot move is not asked to: the other takes the whole push.
        if (fa0) b.position[axis] -= sign * push * 2;
        else if (fb0) a.position[axis] += sign * push * 2;
        else { a.position[axis] += sign * push; b.position[axis] -= sign * push; }
      }
    }
    if (!moved) break;
  }
}

/**
 * Where a part added after others were placed by hand goes.
 *
 * The relaxation has no good answer here: with the rest held still it pushes the
 * newcomer far off to be clear of everything. It is put instead at the free grid
 * spot nearest to whatever it is connected to, or the middle of the board when it
 * is connected to nothing yet.
 */
function settleNewcomers(
  components: CircuitComponent[], nets: Net[],
  placements: Map<string, Placement>, manual: Map<string, Manual>,
) {
  const placed = new Set(manual.keys());
  const taken = (p: Placement, x: number, z: number) => {
    const a = footprintAt(p.extent, p.rotationY, x, z);
    for (const other of placements.values()) {
      if (other.id === p.id || !placed.has(other.id)) continue;
      const b = footprint(other);
      if (a.dx + b.dx + GAP > Math.abs(a.mx - b.mx) && a.dz + b.dz + GAP > Math.abs(a.mz - b.mz)) return true;
    }
    return false;
  };

  for (const c of components) {
    if (manual.has(c.id)) continue;
    const mine = placements.get(c.id);
    if (!mine) continue;
    const friends = nets
      .filter((n) => n.pins.some((pin) => pin.startsWith(`${c.id}.`)))
      .flatMap((n) => n.pins.map((pin) => pin.slice(0, pin.lastIndexOf('.'))))
      .filter((id) => id !== c.id && placed.has(id));
    const anchors = (friends.length ? friends : [...placed]).map((id) => placements.get(id)!.position);
    const cx = anchors.reduce((a, p) => a + p.x, 0) / Math.max(1, anchors.length);
    const cz = anchors.reduce((a, p) => a + p.z, 0) / Math.max(1, anchors.length);
    const gx = Math.round(cx / GRID) * GRID;
    const gz = Math.round(cz / GRID) * GRID;

    let best: { x: number; z: number } | null = null;
    for (let r = 0; r <= 60 && !best; r++) {
      for (let dx = -r; dx <= r && !best; dx++) {
        for (let dz = -r; dz <= r && !best; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = gx + dx * GRID, z = gz + dz * GRID;
          if (!taken(mine, x, z)) best = { x, z };
        }
      }
    }
    if (best) mine.position.set(best.x, 0, best.z);
    placed.add(c.id);
  }
}
