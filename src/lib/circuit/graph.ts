/**
 * Canonicalisation and validation of a recovered circuit graph.
 *
 * The vision stage returns something close to a circuit. This turns it into
 * something the solver can trust: pins filled in per component type, nets merged
 * transitively, wire and junction symbols collapsed, and nets renamed in a stable
 * order so two runs on the same sketch compare equal.
 */

import { PINS, type CircuitComponent, type CircuitGraph, type ComponentType, type Net } from '../types';
import { isBoardType, normaliseBoardPin } from './boards';

class UnionFind {
  private parent = new Map<string, string>();
  find(x: string): string {
    const p = this.parent.get(x);
    if (p == null) { this.parent.set(x, x); return x; }
    if (p === x) return x;
    const r = this.find(p);
    this.parent.set(x, r);
    return r;
  }
  union(a: string, b: string) {
    const ra = this.find(a), rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
  keys() { return [...this.parent.keys()]; }
}

const KNOWN_TYPES = new Set(Object.keys(PINS) as ComponentType[]);

/** Maps the looser type names a model may produce onto the supported set. */
export function normaliseType(raw: string | null | undefined): ComponentType {
  const t = String(raw ?? '').toLowerCase().trim().replace(/[\s-]+/g, '_');
  const alias: Record<string, ComponentType> = {
    r: 'resistor', res: 'resistor', resistance: 'resistor',
    light_emitting_diode: 'led', lamp: 'led', bulb: 'led', light: 'led',
    cell: 'battery', supply: 'battery', voltage_source: 'battery', dc_source: 'battery',
    vcc: 'battery', power_supply: 'battery', power: 'battery',
    gnd: 'ground', earth: 'ground',
    cap: 'capacitor', capacitor_ceramic: 'capacitor', ceramic_capacitor: 'capacitor',
    electrolytic: 'capacitor_electrolytic', electrolytic_capacitor: 'capacitor_electrolytic',
    polarised_capacitor: 'capacitor_electrolytic', polarized_capacitor: 'capacitor_electrolytic',
    spst: 'switch', push_button: 'switch', button: 'switch', pushbutton: 'switch',
    pot: 'potentiometer', variable_resistor: 'potentiometer', rheostat: 'potentiometer',
    bjt: 'transistor', npn: 'transistor', pnp: 'transistor', mosfet: 'transistor',
    dip: 'ic', chip: 'ic', op_amp: 'ic', opamp: 'ic', integrated_circuit: 'ic',
    coil: 'inductor', choke: 'inductor',
    speaker: 'buzzer', piezo: 'buzzer',
    dc_motor: 'motor', fan: 'motor',
    node: 'junction', wire: 'junction', connection: 'junction', dot: 'junction',
    header_pins: 'header', pin_header: 'header',
    oscillator: 'crystal', xtal: 'crystal',
    arduino: 'arduino_uno', uno: 'arduino_uno', arduino_board: 'arduino_uno', arduino_nano: 'arduino_uno',
    microcontroller: 'arduino_uno', mcu: 'arduino_uno', atmega328: 'arduino_uno', atmega328p: 'arduino_uno',
    raspberry: 'raspberry_pi', rpi: 'raspberry_pi', pi: 'raspberry_pi', raspi: 'raspberry_pi',
    raspberrypi: 'raspberry_pi', raspberry_pi_4: 'raspberry_pi', raspberry_pi_3: 'raspberry_pi',
    single_board_computer: 'raspberry_pi', sbc: 'raspberry_pi',
  };
  if (KNOWN_TYPES.has(t as ComponentType)) return t as ComponentType;
  return alias[t] ?? 'unknown';
}

/** Maps loose pin names onto a component's canonical pins. */
function normalisePin(type: ComponentType, raw: string): string {
  const pins = PINS[type];
  const p = raw.toLowerCase().trim();
  if (pins.includes(p)) return p;
  const alias: Record<string, string> = {
    '1': pins[0], '2': pins[1] ?? pins[0], a: pins[0], b: pins[1] ?? pins[0],
    p1: pins[0], p2: pins[1] ?? pins[0], left: pins[0], right: pins[1] ?? pins[0],
    in: pins[0], out: pins[1] ?? pins[0], t1: pins[0], t2: pins[1] ?? pins[0],
    '+': pins.includes('pos') ? 'pos' : pins.includes('anode') ? 'anode' : pins[0],
    '-': pins.includes('neg') ? 'neg' : pins.includes('cathode') ? 'cathode' : pins[1] ?? pins[0],
    plus: pins.includes('pos') ? 'pos' : 'anode', positive: pins.includes('pos') ? 'pos' : 'anode',
    minus: pins.includes('neg') ? 'neg' : 'cathode', negative: pins.includes('neg') ? 'neg' : 'cathode',
    pos: pins.includes('pos') ? 'pos' : pins.includes('anode') ? 'anode' : pins[0],
    neg: pins.includes('neg') ? 'neg' : pins.includes('cathode') ? 'cathode' : pins[1] ?? pins[0],
    anode: pins.includes('anode') ? 'anode' : pins.includes('pos') ? 'pos' : pins[0],
    cathode: pins.includes('cathode') ? 'cathode' : pins.includes('neg') ? 'neg' : pins[1] ?? pins[0],
    gnd: pins[0], w: 'wiper', wiper: pins.includes('wiper') ? 'wiper' : pins[0],
    base: 'base', collector: 'collector', emitter: 'emitter',
    c: pins.includes('collector') ? 'collector' : pins[0],
    e: pins.includes('emitter') ? 'emitter' : pins[1] ?? pins[0],
  };
  return alias[p] ?? pins[0];
}

export interface CanonResult extends CircuitGraph {
  warnings: string[];
  /** Pin refs that belong to no net. */
  floating: string[];
}

export function canonicalise(graph: CircuitGraph): CanonResult {
  const warnings: string[] = [];
  const seenIds = new Set<string>();
  const counters = new Map<string, number>();

  const prefixFor = (t: ComponentType) => (
    { resistor: 'R', led: 'D', diode: 'D', battery: 'B', ground: 'GND', capacitor: 'C',
      capacitor_electrolytic: 'C', switch: 'SW', potentiometer: 'RV', transistor: 'Q',
      ic: 'U', inductor: 'L', crystal: 'X', header: 'J', buzzer: 'LS', motor: 'M',
      arduino_uno: 'UNO', raspberry_pi: 'RPI', junction: 'N', unknown: 'X' } as Record<ComponentType, string>
  )[t];

  // 1. Normalise components: type, id uniqueness, pin set.
  const idMap = new Map<string, string>();
  const components: CircuitComponent[] = [];
  for (const raw of graph.components ?? []) {
    const type = normaliseType(raw.type);
    let id = String(raw.id ?? '').trim();
    if (!id || seenIds.has(id)) {
      const pfx = prefixFor(type);
      const n = (counters.get(pfx) ?? 0) + 1;
      counters.set(pfx, n);
      const fresh = `${pfx}${n}`;
      if (id) warnings.push(`Duplicate component id "${id}" was renamed to "${fresh}".`);
      idMap.set(id || fresh, fresh);
      id = fresh;
    } else {
      idMap.set(id, id);
    }
    seenIds.add(id);
    const pins = [...PINS[type]];
    const pin_states = isBoardType(type) && raw.pin_states
      ? Object.fromEntries(
          Object.entries(raw.pin_states).filter(([pin, st]) => pins.includes(pin) && ['high', 'low', 'input'].includes(st)),
        )
      : undefined;
    components.push({
      ...raw,
      id,
      type,
      pins,
      value: raw.value == null || raw.value === '' ? null : String(raw.value),
      confidence: Number.isFinite(raw.confidence) ? Math.max(0, Math.min(1, raw.confidence)) : 0.5,
      ...(pin_states && Object.keys(pin_states).length ? { pin_states } : { pin_states: undefined }),
    });
  }

  const byId = new Map(components.map((c) => [c.id, c]));
  const unknownBoardPins: string[] = [];
  const resolvePin = (ref: string): string | null => {
    const dot = String(ref).lastIndexOf('.');
    const rawId = dot < 0 ? String(ref) : String(ref).slice(0, dot);
    const rawPin = dot < 0 ? '' : String(ref).slice(dot + 1);
    const id = byId.has(rawId) ? rawId : idMap.get(rawId);
    if (!id || !byId.has(id)) return null;
    const c = byId.get(id)!;
    if (isBoardType(c.type)) {
      // A board's pins are not interchangeable, so an unrecognised one is dropped
      // and reported rather than quietly wired to something else.
      const pin = normaliseBoardPin(c.type, rawPin);
      if (!pin || !c.pins.includes(pin)) {
        unknownBoardPins.push(`${id}.${rawPin || '?'}`);
        return null;
      }
      return `${id}.${pin}`;
    }
    return `${id}.${normalisePin(c.type, rawPin || c.pins[0])}`;
  };

  // 2. Merge nets transitively; a pin appearing in two nets joins them.
  const uf = new UnionFind();
  const netPins = new Map<string, Set<string>>();
  const netGround = new Set<string>();
  const netSource = new Map<string, Net['source']>();
  const netConf = new Map<string, number>();
  let dropped = 0;

  for (const [i, net] of (graph.nets ?? []).entries()) {
    const key = net.id || `n${i}`;
    const pins = new Set<string>();
    for (const p of net.pins ?? []) {
      const r = resolvePin(p);
      if (r) pins.add(r); else dropped++;
    }
    if (pins.size === 0) continue;
    netPins.set(key, pins);
    if (net.is_ground) netGround.add(key);
    if (net.source) netSource.set(key, net.source);
    if (net.confidence != null) netConf.set(key, net.confidence);
    uf.find(key);
  }
  for (const ref of [...new Set(unknownBoardPins)]) {
    const [id, pin] = [ref.slice(0, ref.lastIndexOf('.')), ref.slice(ref.lastIndexOf('.') + 1)];
    warnings.push(`${id} has no pin called "${pin}", so that connection was dropped.`);
  }
  // Board pins that did not resolve are not "components that were not detected".
  dropped = Math.max(0, dropped - unknownBoardPins.length);
  if (dropped > 0) warnings.push(`${dropped} connection reference${dropped === 1 ? '' : 's'} named a component that was not detected and ${dropped === 1 ? 'was' : 'were'} dropped.`);

  // A pin shared between two nets means they are the same node.
  const ownerOf = new Map<string, string>();
  for (const [key, pins] of netPins) {
    for (const pin of pins) {
      const prev = ownerOf.get(pin);
      if (prev) uf.union(prev, key); else ownerOf.set(pin, key);
    }
  }

  // Wire and junction symbols are not devices — they fuse the nets they touch.
  for (const c of components) {
    if (c.type !== 'junction') continue;
    const touching = [...netPins.entries()].filter(([, pins]) => [...pins].some((p) => p.startsWith(`${c.id}.`))).map(([k]) => k);
    for (let i = 1; i < touching.length; i++) uf.union(touching[0], touching[i]);
  }

  // 3. Rebuild merged nets, ordered by their lowest pin so ids are stable.
  const groups = new Map<string, Set<string>>();
  for (const key of netPins.keys()) {
    const root = uf.find(key);
    const set = groups.get(root) ?? new Set<string>();
    for (const p of netPins.get(key)!) set.add(p);
    groups.set(root, set);
  }

  const assembled = [...groups.entries()].map(([root, pins]) => {
    const members = [...netPins.keys()].filter((k) => uf.find(k) === root);
    const list = [...pins].filter((p) => !byId.get(p.split('.')[0])!.type.startsWith('junction')).sort();
    return {
      pins: list.length ? list : [...pins].sort(),
      is_ground: members.some((m) => netGround.has(m)),
      source: members.map((m) => netSource.get(m)).find(Boolean),
      confidence: members.map((m) => netConf.get(m)).filter((x): x is number => x != null).reduce((a, b, _, arr) => a + b / arr.length, 0) || undefined,
    };
  }).filter((n) => n.pins.length > 0);

  assembled.sort((a, b) => (a.pins[0] < b.pins[0] ? -1 : a.pins[0] > b.pins[0] ? 1 : 0));

  // Ground first, so it reads as N1 in the UI only when it genuinely is the reference.
  const nets: Net[] = assembled.map((n, i) => ({
    id: `N${i + 1}`,
    pins: n.pins,
    ...(n.is_ground ? { is_ground: true } : {}),
    ...(n.source ? { source: n.source } : {}),
    ...(n.confidence != null ? { confidence: n.confidence } : {}),
  }));

  // 4. Floating pins: every pin of every real device that landed in no net.
  const connected = new Set(nets.flatMap((n) => n.pins));
  const floating: string[] = [];
  for (const c of components) {
    if (c.type === 'junction' || c.type === 'ic' || c.type === 'header' || isBoardType(c.type)) continue;
    for (const pin of c.pins) {
      const ref = `${c.id}.${pin}`;
      if (!connected.has(ref)) floating.push(ref);
    }
  }

  return { components, nets, warnings, floating };
}
