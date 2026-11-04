/**
 * Orthogonal wire routing.
 *
 * Every net is drawn as a star into a hub on the grid: each lead leaves its pin
 * along its own outward direction for one grid step, then turns at most twice to
 * reach the hub. Two-pin nets come out as a plain L or Z, which is what a series
 * loop should look like; a net joining five leads comes out as a node with a
 * solder dot, which is how a schematic draws exactly that.
 *
 * The leading stub matters: without it a wire can leave a pin straight across
 * the body it just came from.
 */

import type { Net } from '@/lib/types';
import { flagKind, type FlagNet } from './flags';
import { GRID, symbolFor } from './symbols';
import { pinDirection, pinPosition, type Layout2D, type Vec } from './layout2d';
import type { CircuitComponent } from '@/lib/types';

export interface RoutedWire {
  netId: string;
  pinRef: string;
  /** SVG path data, orthogonal throughout. */
  d: string;
  length: number;
  /**
   * True when the node lies behind the pin, so the wire has to run back over the
   * part's own lead to reach it. Drawn, that is a spur sticking out past the
   * node, and it reads as the lead continuing somewhere it does not.
   */
  backtracks: boolean;
}

export interface RoutedNet {
  netId: string;
  wires: RoutedWire[];
  hub: Vec;
  /** Drawn only where three or more leads meet, as convention requires. */
  showJunction: boolean;
  isGround: boolean;
  /** Set when this net's connections came from the model, not the traced masks. */
  inferred: boolean;
  /**
   * Set when the net is drawn as a symbol at each pin instead of as wires between
   * them: ground, and the supply rails of a board.
   */
  flag?: FlagNet;
  flags?: Array<{ at: Vec; dir: Vec }>;
}

const snap = (v: number) => Math.round(v / GRID) * GRID;

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Builds the path from a pin to the hub: stub, then at most two turns. */
function pathToHub(from: Vec, dir: Vec, hub: Vec): { d: string; length: number } {
  // The stub only earns its place when it heads toward the node. Pointing the
  // other way it becomes a spur past the component that the wire then doubles
  // back along — so in that case the wire leaves the pin straight for the hub.
  const towardHub = dir.x * (hub.x - from.x) + dir.y * (hub.y - from.y) > 0;
  const stub: Vec = towardHub
    ? { x: from.x + dir.x * GRID, y: from.y + dir.y * GRID }
    : { ...from };
  const points: Vec[] = [from, stub];

  if (dir.x !== 0) {
    // Left the pin horizontally, so travel horizontally first.
    if (stub.x !== hub.x) points.push({ x: hub.x, y: stub.y });
    if (stub.y !== hub.y) points.push({ x: hub.x, y: hub.y });
  } else {
    if (stub.y !== hub.y) points.push({ x: stub.x, y: hub.y });
    if (stub.x !== hub.x) points.push({ x: hub.x, y: hub.y });
  }
  if (points[points.length - 1].x !== hub.x || points[points.length - 1].y !== hub.y) {
    points.push({ x: hub.x, y: hub.y });
  }

  // Collapse any zero-length steps the stub may have produced.
  const clean = points.filter((p, i) => i === 0 || p.x !== points[i - 1].x || p.y !== points[i - 1].y);
  let length = 0;
  for (let i = 1; i < clean.length; i++) {
    length += Math.abs(clean[i].x - clean[i - 1].x) + Math.abs(clean[i].y - clean[i - 1].y);
  }
  return {
    d: clean.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' '),
    length,
  };
}

/**
 * Where the leads of a net meet.
 *
 * The median is a good centre, but it knows nothing about which way each lead
 * points. Every lead leaves its part in one direction, and a node lying behind
 * it forces the wire back over the lead it just left. So the node is kept on the
 * outward side of every lead that constrains it: no further left than a
 * left-facing lead, no further right than a right-facing one, and likewise
 * vertically. The axes are independent, and when leads disagree on one the
 * median stands, since no node can satisfy them all.
 */
function hubFor(ends: Array<{ at: Vec; dir: Vec }>, outward: boolean): Vec {
  let x = snap(median(ends.map((e) => e.at.x)));
  let y = snap(median(ends.map((e) => e.at.y)));
  if (!outward) return { x, y };

  let minX = -Infinity, maxX = Infinity, minY = -Infinity, maxY = Infinity;
  for (const e of ends) {
    if (e.dir.x < 0) maxX = Math.min(maxX, e.at.x);
    if (e.dir.x > 0) minX = Math.max(minX, e.at.x);
    if (e.dir.y < 0) maxY = Math.min(maxY, e.at.y);
    if (e.dir.y > 0) minY = Math.max(minY, e.at.y);
  }
  if (minX <= maxX) x = Math.min(maxX, Math.max(minX, x));
  if (minY <= maxY) y = Math.min(maxY, Math.max(minY, y));
  return { x, y };
}

export function routeSchematic(
  components: CircuitComponent[],
  nets: Net[],
  layout: Layout2D,
): RoutedNet[] {
  const byId = new Map(components.map((c) => [c.id, c]));
  const routed: RoutedNet[] = [];

  for (const net of nets) {
    const ends = net.pins
      .map((ref) => {
        const [id, pin] = [ref.slice(0, ref.lastIndexOf('.')), ref.slice(ref.lastIndexOf('.') + 1)];
        const component = byId.get(id);
        const placement = layout.placements.get(id);
        if (!component || !placement) return null;
        const local = symbolFor(component).pins[pin];
        if (!local) return null;
        return {
          ref,
          at: pinPosition(placement, local),
          dir: pinDirection(placement, local),
        };
      })
      .filter((x): x is { ref: string; at: Vec; dir: Vec } => x != null);

    if (ends.length < 2) continue;

    const flag = flagKind(net, byId);
    if (flag) {
      // A short lead out of each pin, and the symbol on the end of it.
      routed.push({
        netId: net.id,
        hub: ends[0].at,
        showJunction: false,
        isGround: flag.kind === 'ground',
        inferred: net.source === 'model',
        flag,
        flags: ends.map((e) => ({ at: { x: e.at.x + e.dir.x * GRID, y: e.at.y + e.dir.y * GRID }, dir: e.dir })),
        wires: ends.map((e) => ({
          netId: net.id,
          pinRef: e.ref,
          d: `M ${e.at.x} ${e.at.y} L ${e.at.x + e.dir.x * GRID} ${e.at.y + e.dir.y * GRID}`,
          length: GRID,
          backtracks: false,
        })),
      });
      continue;
    }

    const hub = hubFor(ends, layout.outwardHubs ?? false);

    routed.push({
      netId: net.id,
      hub,
      showJunction: ends.length >= 3,
      isGround: Boolean(net.is_ground),
      inferred: net.source === 'model',
      wires: ends.map((e) => {
        const { d, length } = pathToHub(e.at, e.dir, hub);
        const backtracks = e.dir.x * (hub.x - e.at.x) + e.dir.y * (hub.y - e.at.y) < 0;
        return { netId: net.id, pinRef: e.ref, d, length, backtracks };
      }),
    });
  }

  return routed;
}
