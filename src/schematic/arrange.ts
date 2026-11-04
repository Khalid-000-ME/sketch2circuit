/**
 * Layout, then repair.
 *
 * The relaxation in `layoutSchematic` optimises how close connected parts sit,
 * and it has no notion of what a reader will infer from the drawing. So the
 * result is checked for drawings that mislead (`findConflicts`) and priced for
 * how tidy it is (`drawingCost`). Every part is tried at its other rotations and
 * at nearby grid positions, and a move is kept only when it makes the score
 * strictly lower, so the pass cannot cycle.
 *
 * The score is conflicts first, by a wide margin, then cost. Counting conflicts
 * alone is not enough: a search that is only told to avoid them will happily
 * trade them away for a sprawling drawing, and did.
 *
 * Whether nets meet at the median of their pins or outward of every lead is not
 * assumed either. Both are arranged and the better drawing wins, because which
 * is better depends on the circuit.
 */

import type { CircuitComponent, Net } from '@/lib/types';
import { GRID } from './symbols';
import { boundsOf, layoutSchematic, type Layout2D, type Placement2D } from './layout2d';
import { drawingCost, findConflicts } from './lint';
import { routeSchematic } from './route2d';

const ROTATIONS = [0, 90, 180, 270];
/** Grid steps a part may be nudged, in each axis. */
const NUDGES = [-2, -1, 1, 2];
const MAX_PASSES = 5;
/** One conflict outweighs any plausible difference in tidiness. */
const CONFLICT_WEIGHT = 100_000;

function arrange(components: CircuitComponent[], nets: Net[], outwardHubs: boolean) {
  const score = (l: Layout2D) => {
    const routes = routeSchematic(components, nets, l);
    const conflicts = findConflicts(components, l, routes).length;
    return { total: conflicts * CONFLICT_WEIGHT + drawingCost(routes), conflicts };
  };

  const withPlacement = (l: Layout2D, id: string, next: Placement2D): Layout2D => {
    const placements = new Map(l.placements);
    placements.set(id, next);
    return { placements, bounds: boundsOf(components, placements), outwardHubs };
  };

  let layout: Layout2D = { ...layoutSchematic(components, nets), outwardHubs };
  let best = score(layout);

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (const c of components) {
      const current = layout.placements.get(c.id)!;
      const candidates: Placement2D[] = [];
      for (const rotation of ROTATIONS) {
        if (rotation !== current.rotation) candidates.push({ ...current, rotation });
      }
      for (const step of NUDGES) {
        candidates.push({ ...current, position: { x: current.position.x + step * GRID, y: current.position.y } });
        candidates.push({ ...current, position: { x: current.position.x, y: current.position.y + step * GRID } });
      }

      let bestTrial: Layout2D | null = null;
      let bestScore = best;
      for (const candidate of candidates) {
        const trial = withPlacement(layout, c.id, candidate);
        const s = score(trial);
        if (s.total < bestScore.total) { bestScore = s; bestTrial = trial; }
      }
      if (bestTrial) { layout = bestTrial; best = bestScore; improved = true; }
    }
    if (!improved) break;
  }
  return { layout, score: best };
}

export function arrangeSchematic(components: CircuitComponent[], nets: Net[]): Layout2D {
  const median = arrange(components, nets, false);
  const outward = arrange(components, nets, true);
  return outward.score.total < median.score.total ? outward.layout : median.layout;
}
