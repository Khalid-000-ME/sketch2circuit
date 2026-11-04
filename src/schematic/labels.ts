/**
 * Where a part's reference designator and value are drawn, and how much room
 * they take. Shared by the view and by the conflict check, so what is checked is
 * exactly what is drawn.
 */

import type { CircuitComponent } from '@/lib/types';
import type { Placement2D } from './layout2d';
import { valueLabel } from './symbols';

export interface LabelPos { x: number; y: number; anchor: 'middle' | 'start' }

/**
 * A horizontal part gets its name above and its value below, which is the
 * textbook arrangement. A vertical part gets both stacked to its right, because
 * above and below is exactly where its own leads and wires are.
 *
 * `bodyHalf` is the body in the part's own frame, so once it is turned on its
 * side the width a label must clear is the *second* half-extent, not the first.
 */
export function labelPlacement(p: Placement2D): [LabelPos, LabelPos] {
  const vertical = p.rotation === 90 || p.rotation === 270;
  if (vertical) {
    const x = p.bodyHalf[1] + 15;
    return [
      { x, y: -3, anchor: 'start' },
      { x, y: 14, anchor: 'start' },
    ];
  }
  const y = p.bodyHalf[1];
  return [
    { x: 0, y: -y - 9, anchor: 'middle' },
    { x: 0, y: y + 19, anchor: 'middle' },
  ];
}

export interface LabelBox { owner: string; left: number; top: number; right: number; bottom: number }

/** Monospace glyph widths for the two label sizes, in drawing units. */
const REF_CHAR = 7.8;
const VALUE_CHAR = 7.2;

/** World-space boxes for a part's labels. Text is estimated, not measured. */
export function labelBoxes(c: CircuitComponent, p: Placement2D): LabelBox[] {
  const [refPos, valuePos] = labelPlacement(p);
  const items: Array<[string | null, LabelPos, number]> = [
    [c.id, refPos, REF_CHAR],
    [valueLabel(c), valuePos, VALUE_CHAR],
  ];
  const boxes: LabelBox[] = [];
  for (const [text, pos, charWidth] of items) {
    if (!text) continue;
    const width = text.length * charWidth;
    const left = p.position.x + (pos.anchor === 'middle' ? pos.x - width / 2 : pos.x);
    boxes.push({
      owner: c.id,
      left,
      right: left + width,
      top: p.position.y + pos.y - 11,
      bottom: p.position.y + pos.y + 3,
    });
  }
  return boxes;
}
