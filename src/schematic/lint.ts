/**
 * Does this drawing say something the circuit does not?
 *
 * A schematic can be topologically right and still mislead. Three ways, each of
 * which makes a reader see a connection that is not there or miss one that is:
 *
 *   - wires of different nets lying along each other, so two nets look like one;
 *   - a junction dot sitting on a wire of a net it does not belong to, which is
 *     how a schematic says "these are connected";
 *   - a wire running through a component it does not connect to;
 *   - labels sitting on other labels, on other parts, or on wires; parts on parts;
 *   - on a board, a wire that crosses its body, or one that touches the tip of a
 *     pin it does not belong to — a wire running along a column of pin tips reads
 *     as connected to every one of them.
 *
 * Returned as strings so a failure explains itself.
 */

import type { CircuitComponent } from '@/lib/types';
import { isBoardType } from '@/lib/circuit/boards';
import { pinPosition, type Layout2D } from './layout2d';
import { symbolFor } from './symbols';
import { labelBoxes, type LabelBox } from './labels';
import type { RoutedNet } from './route2d';

interface Seg { x1: number; y1: number; x2: number; y2: number; netId: string; pinRef: string }

function segmentsOf(routes: RoutedNet[]): Seg[] {
  const out: Seg[] = [];
  for (const net of routes) {
    for (const wire of net.wires) {
      const pts = [...wire.d.matchAll(/[ML] (-?[\d.]+) (-?[\d.]+)/g)].map((m) => [Number(m[1]), Number(m[2])]);
      for (let i = 1; i < pts.length; i++) {
        out.push({
          x1: pts[i - 1][0], y1: pts[i - 1][1], x2: pts[i][0], y2: pts[i][1],
          netId: net.netId, pinRef: wire.pinRef,
        });
      }
    }
  }
  return out;
}

/** Length of the collinear overlap between two axis-aligned segments. */
function overlap(a: Seg, b: Seg): number {
  if (a.x1 === a.x2 && b.x1 === b.x2 && a.x1 === b.x1) {
    return Math.max(0, Math.min(Math.max(a.y1, a.y2), Math.max(b.y1, b.y2))
      - Math.max(Math.min(a.y1, a.y2), Math.min(b.y1, b.y2)));
  }
  if (a.y1 === a.y2 && b.y1 === b.y2 && a.y1 === b.y1) {
    return Math.max(0, Math.min(Math.max(a.x1, a.x2), Math.max(b.x1, b.x2))
      - Math.max(Math.min(a.x1, a.x2), Math.min(b.x1, b.x2)));
  }
  return 0;
}

const onSegment = (s: Seg, x: number, y: number) =>
  x >= Math.min(s.x1, s.x2) - 0.5 && x <= Math.max(s.x1, s.x2) + 0.5
  && y >= Math.min(s.y1, s.y2) - 0.5 && y <= Math.max(s.y1, s.y2) + 0.5
  && (s.x1 === s.x2 ? Math.abs(x - s.x1) < 0.5 : Math.abs(y - s.y1) < 0.5);

export function findConflicts(
  components: CircuitComponent[],
  layout: Layout2D,
  routes: RoutedNet[],
): string[] {
  const segs = segmentsOf(routes);
  const problems: string[] = [];

  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      if (segs[i].netId === segs[j].netId) continue;
      const len = overlap(segs[i], segs[j]);
      if (len > 1) {
        problems.push(`overlap ${len.toFixed(0)}px: ${segs[i].netId}(${segs[i].pinRef}) on ${segs[j].netId}(${segs[j].pinRef})`);
      }
    }
  }

  for (const net of routes) {
    if (!net.showJunction) continue;
    for (const s of segs) {
      if (s.netId !== net.netId && onSegment(s, net.hub.x, net.hub.y)) {
        problems.push(`junction dot of ${net.netId} at (${net.hub.x},${net.hub.y}) sits on ${s.netId}'s wire (${s.pinRef})`);
      }
    }
  }

  for (const c of components) {
    const p = layout.placements.get(c.id);
    if (!p) continue;
    const [bx, by] = p.rotation % 180 === 0 ? p.bodyHalf : [p.bodyHalf[1], p.bodyHalf[0]];
    // Every wire counts, the part's own included. A wire from a pin that runs
    // across the part it came from reads as that part being shorted out.
    for (const s of segs) {
      const horizontal = s.y1 === s.y2;
      const inside = horizontal
        ? Math.abs(s.y1 - p.position.y) < by
          && Math.min(s.x1, s.x2) < p.position.x + bx && Math.max(s.x1, s.x2) > p.position.x - bx
        : Math.abs(s.x1 - p.position.x) < bx
          && Math.min(s.y1, s.y2) < p.position.y + by && Math.max(s.y1, s.y2) > p.position.y - by;
      if (inside) problems.push(`${s.netId}'s wire (${s.pinRef}) runs through ${c.id}'s body`);
    }
  }

  // A lead whose node lies behind it. The router will detour round the part, so
  // this is no longer wrong, but a detour is a spur by another name, and a layout
  // that turned the part the right way round has none. Without this penalty the
  // arrangement has no reason to try. Skipped for a net holding two pins of the
  // same part: that is a part shorted across itself, its leads face opposite
  // ways, and no node can lie outward of both.
  for (const net of routes) {
    const owners = net.wires.map((w) => w.pinRef.slice(0, w.pinRef.lastIndexOf('.')));
    if (new Set(owners).size < owners.length) continue;
    for (const wire of net.wires) {
      if (wire.backtracks) problems.push(`${wire.pinRef} runs back past its own part to reach ${net.netId}`);
    }
  }

  // Labels on labels, and labels on other parts.
  const bodies = components.flatMap((c) => {
    const p = layout.placements.get(c.id);
    if (!p) return [];
    const [hx, hy] = p.rotation % 180 === 0 ? p.bodyHalf : [p.bodyHalf[1], p.bodyHalf[0]];
    return [{ id: c.id, left: p.position.x - hx, right: p.position.x + hx, top: p.position.y - hy, bottom: p.position.y + hy }];
  });
  const labels: LabelBox[] = components.flatMap((c) => {
    const p = layout.placements.get(c.id);
    return p ? labelBoxes(c, p) : [];
  });
  const hit = (a: { left: number; right: number; top: number; bottom: number }, b: typeof a, pad = 0) =>
    a.left < b.right + pad && a.right > b.left - pad && a.top < b.bottom + pad && a.bottom > b.top - pad;

  for (let i = 0; i < labels.length; i++) {
    for (let j = i + 1; j < labels.length; j++) {
      if (labels[i].owner !== labels[j].owner && hit(labels[i], labels[j])) {
        problems.push(`labels of ${labels[i].owner} and ${labels[j].owner} overlap`);
      }
    }
    for (const body of bodies) {
      if (body.id !== labels[i].owner && hit(labels[i], body)) {
        problems.push(`a label of ${labels[i].owner} sits on ${body.id}`);
      }
    }
  }
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      if (hit(bodies[i], bodies[j], 6)) problems.push(`${bodies[i].id} and ${bodies[j].id} overlap`);
    }
  }
  // Boards: dozens of pins in a column make "which one is this wire on" a real question.
  const distToSegment = (s: Seg, px: number, py: number) => {
    const dx = s.x2 - s.x1, dy = s.y2 - s.y1;
    const len2 = dx * dx + dy * dy;
    const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2));
    return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy));
  };
  for (const c of components) {
    if (!isBoardType(c.type)) continue;
    const p = layout.placements.get(c.id);
    if (!p) continue;
    const inner = {
      left: p.position.x - p.bodyHalf[0] + 3, right: p.position.x + p.bodyHalf[0] - 3,
      top: p.position.y - p.bodyHalf[1] + 3, bottom: p.position.y + p.bodyHalf[1] - 3,
    };
    for (const seg of segs) {
      const box = { left: Math.min(seg.x1, seg.x2), right: Math.max(seg.x1, seg.x2), top: Math.min(seg.y1, seg.y2), bottom: Math.max(seg.y1, seg.y2) };
      if (hit(inner, box)) problems.push(`${seg.netId}'s wire (${seg.pinRef}) crosses ${c.id}`);
    }
    for (const [pin, local] of Object.entries(symbolFor(c).pins)) {
      const tip = pinPosition(p, local);
      for (const seg of segs) {
        if (seg.pinRef === `${c.id}.${pin}`) continue;
        if (distToSegment(seg, tip.x, tip.y) < 7) problems.push(`${seg.netId}'s wire (${seg.pinRef}) touches ${c.id}.${pin}`);
      }
    }
  }

  // A label under a wire is unreadable however good its halo is.
  for (const label of labels) {
    for (const s of segs) {
      const seg = { left: Math.min(s.x1, s.x2), right: Math.max(s.x1, s.x2), top: Math.min(s.y1, s.y2), bottom: Math.max(s.y1, s.y2) };
      if (hit(label, seg, 1)) problems.push(`a label of ${label.owner} is under ${s.netId}'s wire (${s.pinRef})`);
    }
  }

  return [...new Set(problems)];
}

/**
 * How good a conflict-free drawing is, as a single number where lower is better.
 *
 * Without it a search that only counts conflicts is free to buy a clean report
 * with a sprawling drawing — long wires, three parallel runs, loops around labels
 * — which is exactly what happened. So the picture as a whole is priced: total
 * wire length, perpendicular crossings of different nets, and bends.
 */
export function drawingCost(routes: RoutedNet[]): number {
  const segs = segmentsOf(routes);
  let length = 0;
  for (const s of segs) length += Math.abs(s.x2 - s.x1) + Math.abs(s.y2 - s.y1);

  let crossings = 0;
  for (let i = 0; i < segs.length; i++) {
    for (let j = i + 1; j < segs.length; j++) {
      const a = segs[i], b = segs[j];
      if (a.netId === b.netId) continue;
      const aH = a.y1 === a.y2, bH = b.y1 === b.y2;
      if (aH === bH) continue;
      const h = aH ? a : b, v = aH ? b : a;
      if (v.x1 > Math.min(h.x1, h.x2) && v.x1 < Math.max(h.x1, h.x2)
        && h.y1 > Math.min(v.y1, v.y2) && h.y1 < Math.max(v.y1, v.y2)) crossings++;
    }
  }

  const bends = routes.reduce((n, net) => n + net.wires.reduce((m, w) => m + (w.d.match(/L /g)?.length ?? 1) - 1, 0), 0);
  return length + crossings * 60 + bends * 12;
}
