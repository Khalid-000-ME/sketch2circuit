/**
 * Editing a circuit by hand.
 *
 * Everything here is a pure function from a graph to a graph, so what an edit
 * does can be checked without a browser. The server canonicalises whatever comes
 * out (renames nets, drops anything impossible), so these only need to produce a
 * graph that says what the person meant.
 */

import { PINS, type CircuitComponent, type ComponentType, type Net } from '../types';
import type { PartDef } from './partdef';

export interface PartKind {
  type: ComponentType;
  label: string;
  /** What the part is given when it is first added. */
  value: string | null;
  group: 'basic' | 'active' | 'board' | 'more' | 'mine';
  /** A part the person described; it carries its own definition. */
  custom?: PartDef;
}

/** A saved, described part as a palette entry. */
export function kindFromDef(def: PartDef, group: 'more' | 'mine' = 'mine'): PartKind {
  return {
    type: 'custom',
    label: def.name,
    value: def.param ? String(def.param.default) : null,
    group,
    custom: def,
  };
}

/** What can be added from the palette, in the order it is shown. */
export const PARTS: PartKind[] = [
  { type: 'resistor', label: 'Resistor', value: '1k', group: 'basic' },
  { type: 'led', label: 'LED', value: 'red', group: 'basic' },
  { type: 'battery', label: 'Battery', value: '9', group: 'basic' },
  { type: 'capacitor', label: 'Capacitor', value: '100n', group: 'basic' },
  { type: 'capacitor_electrolytic', label: 'Electrolytic cap', value: '10u', group: 'basic' },
  { type: 'switch', label: 'Switch', value: 'closed', group: 'basic' },
  { type: 'diode', label: 'Diode', value: null, group: 'basic' },
  { type: 'potentiometer', label: 'Potentiometer', value: '10k', group: 'basic' },
  { type: 'inductor', label: 'Inductor', value: '1m', group: 'basic' },
  { type: 'buzzer', label: 'Buzzer', value: '100', group: 'active' },
  { type: 'motor', label: 'Motor', value: '10', group: 'active' },
  { type: 'transistor', label: 'Transistor', value: 'NPN', group: 'active' },
  { type: 'arduino_uno', label: 'Arduino Uno', value: null, group: 'board' },
  { type: 'raspberry_pi', label: 'Raspberry Pi', value: null, group: 'board' },
];

const PREFIX: Partial<Record<ComponentType, string>> = {
  resistor: 'R', led: 'D', diode: 'D', battery: 'B', capacitor: 'C', capacitor_electrolytic: 'C',
  switch: 'SW', potentiometer: 'RV', transistor: 'Q', inductor: 'L', buzzer: 'LS', motor: 'M',
  arduino_uno: 'U', raspberry_pi: 'RPI', ic: 'U', crystal: 'X',
};

/** The next free reference designator for a part: R1, R2, then R3. */
export function nextId(components: CircuitComponent[], type: ComponentType, custom?: PartDef): string {
  const prefix = custom?.prefix ?? PREFIX[type] ?? 'X';
  const used = new Set(components.map((c) => c.id));
  for (let n = 1; ; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
}

export function makeComponent(components: CircuitComponent[], kind: PartKind): CircuitComponent {
  return {
    id: nextId(components, kind.type, kind.custom),
    type: kind.type,
    value: kind.value,
    unit: null,
    orientation: null,
    bbox: null,
    mask_id: null,
    // Placed by hand, so there is nothing uncertain about it.
    confidence: 1,
    pins: kind.custom ? kind.custom.pins.map((p) => p.name) : [...PINS[kind.type]],
    user_edited: true,
    ...(kind.custom ? { custom: kind.custom } : {}),
  };
}

const pinsOf = (net: Net) => new Set(net.pins);

/**
 * Joins two pins. Whatever nets they are already on become one; a pin on no net
 * is added to the other's; two bare pins get a net of their own.
 */
export function connectPins(nets: Net[], a: string, b: string, source: Net['source'] = 'user'): Net[] {
  if (a === b) return nets;
  const na = nets.find((n) => pinsOf(n).has(a));
  const nb = nets.find((n) => pinsOf(n).has(b));
  if (na && na === nb) return nets;

  if (na && nb) {
    const merged: Net = {
      ...na,
      pins: [...new Set([...na.pins, ...nb.pins])],
      is_ground: Boolean(na.is_ground || nb.is_ground) || undefined,
      source,
    };
    return [...nets.filter((n) => n !== na && n !== nb), merged];
  }
  if (na) return nets.map((n) => (n === na ? { ...n, pins: [...n.pins, b], source } : n));
  if (nb) return nets.map((n) => (n === nb ? { ...n, pins: [...n.pins, a], source } : n));
  return [...nets, { id: `E${nets.length + 1}`, pins: [a, b], source }];
}

/**
 * Takes one pin off its net. A net left holding a single pin connects nothing, so
 * it goes; the pin it leaves behind is simply unconnected, which is what the
 * floating-pin check is for.
 */
export function disconnectPin(nets: Net[], pin: string): Net[] {
  return nets
    .map((n) => (pinsOf(n).has(pin) ? { ...n, pins: n.pins.filter((p) => p !== pin) } : n))
    .filter((n) => n.pins.length >= 2);
}

/** Removes a part and every connection to it. */
export function removePart(components: CircuitComponent[], nets: Net[], id: string) {
  return {
    components: components.filter((c) => c.id !== id),
    nets: nets
      .map((n) => ({ ...n, pins: n.pins.filter((p) => p.slice(0, p.lastIndexOf('.')) !== id) }))
      .filter((n) => n.pins.length >= 2),
  };
}

/** How a pin is currently connected, for the interface to describe. */
export function netOfPin(nets: Net[], pin: string): Net | undefined {
  return nets.find((n) => pinsOf(n).has(pin));
}
