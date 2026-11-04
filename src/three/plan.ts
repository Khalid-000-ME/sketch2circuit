/**
 * Wire planning, with no rendering in it.
 *
 * A wire is a curve from pin to pin. It rises straight up from each pin, runs at
 * a cruise height that clears every part under its path, and comes straight down.
 * Wires are planned one after another, and each takes the lowest height at which
 * it neither enters a part nor touches a wire of another net. That makes the
 * result checkable without a browser: see `scripts/check-3d.ts`.
 */

import * as THREE from 'three';
import type { Net } from '@/lib/types';

export const TUBE_R = 0.045;
export const LIFT = 0.42;
/** Air between a wire and anything it passes over. */
const CLEARANCE = 0.16;
/** Gap kept between two wires of different nets, surface to surface. */
const WIRE_GAP = 0.04;
/** Height step tried when a wire has to move out of the way. */
const STEP = 0.14;
const MAX_STEPS = 10;
const LANES = [0, 0.18, -0.18, 0.36, -0.36, 0.54, -0.54];
/** Around its own pin a wire may be inside its own part's box: that is the lead. */
const OWN_ZONE = 0.5;

export interface Obstacle {
  id: string;
  box: THREE.Box3;
}

export interface PlannedWire {
  netId: string;
  curve: THREE.CatmullRomCurve3;
  /** Components this wire ends on; null for a hub end. */
  ends: [string | null, string | null];
  /** Pin references at its two ends; the second is null at a hub. */
  pins: [string, string | null];
}

export interface PlannedNet {
  netId: string;
  wires: PlannedWire[];
  hub: THREE.Vector3 | null;
}

function shape(a: THREE.Vector3, b: THREE.Vector3, cruise: number, lateral = 0): THREE.CatmullRomCurve3 {
  const up = (p: THREE.Vector3) => p.clone().setY(p.y + (cruise - p.y) * 0.55);
  const dir = new THREE.Vector3(b.x - a.x, 0, b.z - a.z);
  // Sideways, level with the board, so a wire can take a lane beside another.
  const side = dir.lengthSq() > 1e-8
    ? new THREE.Vector3(-dir.z, 0, dir.x).normalize().multiplyScalar(lateral)
    : new THREE.Vector3();
  const at = (t: number, k: number) => new THREE.Vector3().lerpVectors(a, b, t).setY(cruise).addScaledVector(side, k);
  return new THREE.CatmullRomCurve3(
    [a.clone(), up(a), at(0.14, 0.6), at(0.5, 1), at(0.86, 0.6), up(b), b.clone()],
    false,
    'centripetal',
  );
}

/** The highest top among parts under the straight run from a to b. */
function topUnder(a: THREE.Vector3, b: THREE.Vector3, obstacles: Obstacle[], skip: Set<string>): number {
  let top = 0;
  const steps = 28;
  for (let i = 0; i <= steps; i++) {
    const x = a.x + ((b.x - a.x) * i) / steps;
    const z = a.z + ((b.z - a.z) * i) / steps;
    for (const o of obstacles) {
      const m = TUBE_R + 0.06;
      if (x < o.box.min.x - m || x > o.box.max.x + m || z < o.box.min.z - m || z > o.box.max.z + m) continue;
      // Only the ends of the run are allowed to touch their own part.
      if (skip.has(o.id) && (i <= 3 || i >= steps - 3)) continue;
      top = Math.max(top, o.box.max.y);
    }
  }
  return top;
}

/** Whether any sample of the curve sits inside a part it is not leaving. */
export function enteredPart(
  points: THREE.Vector3[],
  endA: THREE.Vector3,
  endB: THREE.Vector3,
  ends: [string | null, string | null],
  obstacles: Obstacle[],
): string | null {
  for (const o of obstacles) {
    const box = o.box.clone().expandByScalar(TUBE_R);
    for (const p of points) {
      if (!box.containsPoint(p)) continue;
      const nearOwn =
        (ends[0] === o.id && Math.hypot(p.x - endA.x, p.z - endA.z) < OWN_ZONE) ||
        (ends[1] === o.id && Math.hypot(p.x - endB.x, p.z - endB.z) < OWN_ZONE);
      if (!nearOwn) return o.id;
    }
  }
  return null;
}

/** Smallest distance between two sampled curves. */
export function curveGap(a: THREE.Vector3[], b: THREE.Vector3[]): number {
  let best = Infinity;
  for (const p of a) for (const q of b) best = Math.min(best, p.distanceToSquared(q));
  return Math.sqrt(best);
}

interface Job {
  netId: string;
  a: THREE.Vector3;
  b: THREE.Vector3;
  ends: [string | null, string | null];
  pins: [string, string | null];
}

/**
 * Places wires in the given order; returns the plan and the jobs that found no
 * clean route. A wire that fails is usually boxed in by one placed before it, so
 * the caller tries again with the failures first.
 */
function placeAll(jobs: Job[], obstacles: Obstacle[]) {
  const done: Array<{ netId: string; points: THREE.Vector3[] }> = [];
  const curves = new Map<Job, THREE.CatmullRomCurve3>();
  const failed: Job[] = [];

  for (const { netId, a, b, ends } of jobs) {
    const job = jobs.find((j) => j.a === a && j.b === b)!;
    const span = a.distanceTo(b);
    const skip = new Set(ends.filter((e): e is string => e != null));
    const base = Math.max(
      LIFT + Math.min(span * 0.06, 0.6),
      topUnder(a, b, obstacles, skip) + CLEARANCE,
      a.y + CLEARANCE,
      b.y + CLEARANCE,
    );
    // Cheapest first: a little height costs less than a lot, a lane costs a bit.
    const options: Array<{ k: number; lateral: number; cost: number }> = [];
    for (let k = 0; k < MAX_STEPS; k++) {
      for (const lateral of LANES) options.push({ k, lateral, cost: k * STEP + Math.abs(lateral) * 0.6 });
    }
    options.sort((x, y) => x.cost - y.cost);

    let chosen: { curve: THREE.CatmullRomCurve3; points: THREE.Vector3[] } | null = null;
    let fallback: { curve: THREE.CatmullRomCurve3; points: THREE.Vector3[] } | null = null;
    for (const o of options) {
      const curve = shape(a, b, base + o.k * STEP, o.lateral);
      const points = curve.getPoints(70);
      fallback = fallback ?? { curve, points };
      const bad = enteredPart(points, a, b, ends, obstacles) != null
        || done.some((w) => w.netId !== netId && curveGap(points, w.points) < TUBE_R * 2 + WIRE_GAP);
      if (!bad) { chosen = { curve, points }; break; }
    }
    if (!chosen) failed.push(job);
    const final = chosen ?? fallback!;
    done.push({ netId, points: final.points });
    curves.set(job, final.curve);
  }
  return { curves, failed };
}

export function planNets(
  nets: Net[],
  pinPositions: Map<string, THREE.Vector3>,
  obstacles: Obstacle[],
): PlannedNet[] {
  const shells: Array<{ netId: string; hub: THREE.Vector3 | null; jobs: Job[] }> = [];

  for (const net of nets) {
    const pts = net.pins
      .map((ref) => ({ ref, comp: ref.split('.')[0], p: pinPositions.get(ref) }))
      .filter((x): x is { ref: string; comp: string; p: THREE.Vector3 } => x.p != null);
    if (pts.length < 2) continue;

    if (pts.length === 2) {
      shells.push({ netId: net.id, hub: null, jobs: [{ netId: net.id, a: pts[0].p, b: pts[1].p, ends: [pts[0].comp, pts[1].comp], pins: [pts[0].ref, pts[1].ref] }] });
      continue;
    }

    const hub = new THREE.Vector3();
    for (const { p } of pts) hub.add(p);
    hub.divideScalar(pts.length);
    // The junction floats above whatever it is over, never inside it.
    hub.y = Math.max(
      LIFT * 0.9,
      topUnder(hub, hub, obstacles, new Set()) + CLEARANCE + TUBE_R * 2,
      ...pts.map(({ p }) => p.y + CLEARANCE),
    );
    shells.push({
      netId: net.id,
      hub,
      jobs: pts.map(({ ref, comp, p }) => ({ netId: net.id, a: p, b: hub, ends: [comp, null] as [string, null], pins: [ref, null] as [string, null] })),
    });
  }

  let order = shells.flatMap((s) => s.jobs);
  let best = placeAll(order, obstacles);
  for (let attempt = 0; attempt < 6 && best.failed.length > 0; attempt++) {
    const failed = new Set(best.failed);
    order = [...order.filter((j) => failed.has(j)), ...order.filter((j) => !failed.has(j))];
    const next = placeAll(order, obstacles);
    if (next.failed.length < best.failed.length) best = next;
    else if (next.failed.length === best.failed.length) { best = next; }
    else break;
  }

  return shells.map((s) => ({
    netId: s.netId,
    hub: s.hub,
    wires: s.jobs.map((j) => ({ netId: s.netId, curve: best.curves.get(j)!, ends: j.ends, pins: j.pins })),
  }));
}
