/**
 * Nets that are drawn as symbols instead of wires.
 *
 * Every schematic tool does this for ground and for supply rails, and for the
 * same reason: a ground that is drawn as a wire has to be routed to every part
 * that uses it, and on a board with its pins down both sides that means wires
 * running the length of the symbol, across other pins, and around the back. A
 * ground symbol at each end of the connection says the same thing in no space at
 * all, and nothing can be misread as touching a pin it is not on.
 *
 * Only nets that reach a board's supply or ground pins are drawn this way. A
 * battery wired round a loop is easier for a beginner to follow as a loop, so
 * plain circuits keep their wires.
 */

import type { CircuitComponent, Net } from '@/lib/types';
import { BOARDS, isBoardType } from '@/lib/circuit/boards';

export interface FlagNet {
  kind: 'ground' | 'power';
  /** The text beside a power flag: the name of the pin that supplies the rail. */
  label: string;
}

export function flagKind(net: Net, byId: Map<string, CircuitComponent>): FlagNet | null {
  if (net.pins.length < 2) return null;
  let power: FlagNet | null = null;
  for (const ref of net.pins) {
    const id = ref.slice(0, ref.lastIndexOf('.'));
    const pin = ref.slice(ref.lastIndexOf('.') + 1);
    const part = byId.get(id);
    if (!part || !isBoardType(part.type)) continue;
    if (pin === 'GND') return { kind: 'ground', label: 'GND' };
    if (!power && (pin in BOARDS[part.type].power || pin === 'VIN')) power = { kind: 'power', label: pin };
  }
  return power;
}
