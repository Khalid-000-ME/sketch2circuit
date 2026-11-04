/**
 * Connections written on the page.
 *
 * A wiring table or a list of arrows is an explicit statement of how things are
 * joined, which is a different kind of evidence from a wobbly drawn line, and it
 * is handled differently:
 *
 *   - a line that adds a connection nothing else contradicts is applied;
 *   - a line already true of the drawing is left alone and shown as confirmed;
 *   - a line that would join two connections the drawing has already established
 *     is NOT applied. Merging two nets by mistake is how a supply gets shorted, so
 *     it is reported, and one click applies it if the table is the one that is right.
 *
 * Whether a line is in the circuit is a question about the circuit as it is now,
 * not as it was read, so `specStatus` is a pure function of the current nets and
 * the checklist stays honest while the person edits.
 */

import { PINS, type CircuitComponent, type Net, type SpecConnection } from '../types';
import { isBoardType, normaliseBoardPin } from './boards';
import { connectPins, netOfPin } from './edit';
import { normalisePin } from './graph';

export interface RawSpec { from: string; to: string; text?: string }

export type SpecStatus =
  /** Already joined. */
  | 'satisfied'
  /** Not joined, and joining adds a connection without disturbing another. */
  | 'open'
  /** Not joined, and both ends already belong to different connections. */
  | 'conflict';

/** Parts whose two ends are interchangeable, so "R1" alone is a complete statement. */
const SYMMETRIC = new Set(['resistor', 'capacitor', 'inductor', 'switch', 'crystal', 'motor']);

export function specStatus(item: Pick<SpecConnection, 'a' | 'b'>, nets: Net[]): SpecStatus {
  const na = netOfPin(nets, item.a);
  const nb = netOfPin(nets, item.b);
  if (na && na === nb) return 'satisfied';
  if (!na || !nb) return 'open';
  return 'conflict';
}

type Resolved = { part: CircuitComponent; pin: string | null } | { error: string };

/** "R1.a", "r1", "UNO1.D13" against the parts that exist. A null pin means none was written. */
function resolveEndpoint(components: CircuitComponent[], raw: string): Resolved {
  const text = String(raw ?? '').trim();
  if (!text) return { error: 'an end is empty' };
  const dot = text.lastIndexOf('.');
  const idText = dot < 0 ? text : text.slice(0, dot);
  const pinText = dot < 0 ? '' : text.slice(dot + 1);

  const key = (s: string) => s.toLowerCase().replace(/\s+/g, '');
  const part = components.find((c) => c.id === idText) ?? components.find((c) => key(c.id) === key(idText));
  if (!part) return { error: `"${idText}" is not a part in this circuit` };
  if (!pinText) return { part, pin: null };

  if (isBoardType(part.type)) {
    const pin = normaliseBoardPin(part.type, pinText);
    return pin && part.pins.includes(pin) ? { part, pin } : { error: `${part.id} has no pin "${pinText}"` };
  }
  const pin = normalisePin(part.type, pinText);
  return PINS[part.type].includes(pin) ? { part, pin } : { error: `${part.id} has no pin "${pinText}"` };
}

/** An end of this part that nothing is connected to yet. */
function freePin(part: CircuitComponent, nets: Net[], avoid: string | null): string | null {
  return part.pins.find((pin) => `${part.id}.${pin}` !== avoid && !netOfPin(nets, `${part.id}.${pin}`)) ?? null;
}

export interface AppliedSpec {
  nets: Net[];
  items: SpecConnection[];
  warnings: string[];
}

/**
 * Reads the written connections against the parts and applies the ones that are safe.
 *
 * Lines are taken in the order written, because a table is read top to bottom and
 * "D13 -> R1" followed by "R1 -> LED +" means two different ends of R1: the first
 * line uses one end and the second finds the other still free.
 */
export function applySpec(components: CircuitComponent[], nets: Net[], raws: RawSpec[]): AppliedSpec {
  let current = nets;
  const items: SpecConnection[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  raws.forEach((raw, i) => {
    const text = (raw.text ?? `${raw.from} -> ${raw.to}`).trim();
    const from = resolveEndpoint(components, raw.from);
    const to = resolveEndpoint(components, raw.to);
    const bad = 'error' in from ? from.error : 'error' in to ? to.error : null;
    if (bad || 'error' in from || 'error' in to) {
      warnings.push(`Could not use "${text}": ${bad}.`);
      return;
    }

    // A part named without a pin. Fine for a resistor, which has no wrong end, and
    // a guess for anything else, so it is refused instead of guessed.
    //
    // Which end of the resistor is judged by what is already true. If one end
    // already sits on the same connection as the other endpoint, the line is
    // describing that end, and it is simply confirmed. Only when neither does is a
    // free end taken. Taking the first free end unconditionally read "R1 -> LED +"
    // on a drawn circuit as a contradiction, because both of R1's ends were already
    // connected and it fell back to the wrong one.
    const bind = (end: { part: CircuitComponent; pin: string | null }, other: { part: CircuitComponent; pin: string | null }) => {
      if (end.pin) return end.pin;
      if (!SYMMETRIC.has(end.part.type)) return null;
      if (other.pin) {
        const target = netOfPin(current, `${other.part.id}.${other.pin}`);
        const already = target && end.part.pins.find((pin) => netOfPin(current, `${end.part.id}.${pin}`) === target);
        if (already) return already;
      }
      const avoid = other.part.id === end.part.id && other.pin ? `${other.part.id}.${other.pin}` : null;
      return freePin(end.part, current, avoid) ?? end.part.pins[0];
    };
    const pa = bind(from, to);
    const pb = bind(to, { part: from.part, pin: pa });
    if (!pa || !pb) {
      const which = !pa ? from.part : to.part;
      warnings.push(`Could not use "${text}": which lead of ${which.id}? Write the pin, such as + or anode.`);
      return;
    }

    const a = `${from.part.id}.${pa}`;
    const b = `${to.part.id}.${pb}`;
    const pair = [a, b].sort().join('|');
    if (a === b || seen.has(pair)) return;
    seen.add(pair);

    const item: SpecConnection = { id: `s${i + 1}`, text, a, b };
    items.push(item);
    if (specStatus(item, current) === 'open') current = connectPins(current, a, b, 'written');
  });

  const conflicts = items.filter((it) => specStatus(it, current) === 'conflict');
  for (const c of conflicts) {
    warnings.push(
      `"${c.text}" was not applied: ${c.a} and ${c.b} are already joined to other things, and connecting them would merge those. The drawing was kept.`,
    );
  }
  return { nets: current, items, warnings };
}
