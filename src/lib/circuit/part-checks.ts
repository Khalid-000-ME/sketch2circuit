/**
 * Putting a described part on a bench.
 *
 * Each check says how to drive the part (sources, loads, a ground) and what to
 * expect (a voltage between two pins, a current into one). The setup is turned
 * into an ordinary circuit and handed to the same solver the rest of the app
 * uses, so a part passes only if the circuit it actually forms behaves the way
 * its description says.
 */

import type { CircuitGraph, CircuitComponent, Net } from '../types';
import { canonicalise } from './graph';
import { solveDC } from './solve';
import type { PartCheck, PartDef, Element } from './partdef';

export interface CheckResult {
  say: string;
  pass: boolean;
  /** One line per expectation: what was measured against what was asked. */
  detail: string[];
}

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a === 0) return '0';
  if (a >= 1) return n.toFixed(3).replace(/\.?0+$/, '');
  if (a >= 1e-3) return `${(n * 1e3).toFixed(3).replace(/\.?0+$/, '')}m`;
  return n.toExponential(2);
};

function bench(def: PartDef, check: PartCheck): { graph: CircuitGraph; groundPin: string | null } {
  const driverElements: Element[] = [];
  const driverPins: PartDef['pins'] = [];
  const links: Array<[string, string]> = []; // driver pin -> part pin
  let groundPin: string | null = null;

  const pin = (name: string) => { driverPins.push({ name, side: 'left', label: name }); return name; };

  check.drive.forEach((d, i) => {
    if (d.kind === 'vsource') {
      const p = pin(`s${i}p`); const n = pin(`s${i}n`);
      driverElements.push({ kind: 'vsource', p, n, volts: d.volts ?? 0, rint: d.rint ?? 0 });
      links.push([p, d.pos!], [n, d.neg!]);
      groundPin ??= d.neg!;
    } else if (d.kind === 'resistor') {
      const a = pin(`r${i}a`); const b = pin(`r${i}b`);
      driverElements.push({ kind: 'resistor', a, b, ohms: d.ohms ?? 1 });
      links.push([a, d.a!], [b, d.b!]);
    } else if (d.kind === 'ground') {
      groundPin = d.pin!;
    }
  });

  const driver: PartDef = {
    ...def, name: 'bench', prefix: 'T', pins: driverPins, internals: [], elements: driverElements,
    ratings: [], checks: [], param: null,
  };
  const components: CircuitComponent[] = [
    comp('P1', def, check.value != null ? String(check.value) : null),
    comp('T1', driver, null),
  ];
  const nets: Net[] = links.map(([d, p], i) => ({ id: `L${i}`, pins: [`T1.${d}`, `P1.${p}`] }));
  // A pin that is only measured still needs a node to be read at.
  const linked = new Set(links.map(([, p]) => p));
  for (const x of check.expect) {
    for (const name of [x.a, x.b]) {
      if (name && !linked.has(name) && !(groundPin === name)) { nets.push({ id: `P_${name}`, pins: [`P1.${name}`] }); linked.add(name); }
    }
  }
  // A ground that is not any source's return is its own net on that pin.
  if (groundPin) {
    const net = nets.find((n) => n.pins.includes(`P1.${groundPin}`));
    if (net) net.is_ground = true;
    else nets.push({ id: 'G', pins: [`P1.${groundPin}`], is_ground: true });
  }
  return { graph: { components, nets }, groundPin };
}

function comp(id: string, def: PartDef, value: string | null): CircuitComponent {
  return {
    id, type: 'custom', value, unit: null, orientation: null, bbox: null, mask_id: null,
    confidence: 1, pins: def.pins.map((p) => p.name), custom: def,
  };
}

export function runCheck(def: PartDef, check: PartCheck): CheckResult {
  const { graph } = bench(def, check);
  const canon = canonicalise(graph);
  const sim = solveDC(canon);
  if (sim.status !== 'ok') {
    return { say: check.say, pass: false, detail: [`the bench circuit did not solve: ${sim.reason ?? sim.status}`] };
  }
  const voltageOf = (pinName: string): number | null => {
    const net = canon.nets.find((n) => n.pins.includes(`P1.${pinName}`));
    return net ? sim.node_voltages[net.id] ?? null : null;
  };
  const detail: string[] = [];
  let pass = true;
  for (const x of check.expect) {
    let measured: number | null;
    let what: string;
    if (x.kind === 'voltage') {
      const a = voltageOf(x.a!);
      // With no second pin the reading is against the bench ground, which is the
      // node every solved voltage is already measured from.
      const b = x.b ? voltageOf(x.b) : 0;
      measured = a != null && b != null ? a - b : null;
      what = x.b ? `V(${x.a} to ${x.b})` : `V(${x.a})`;
    } else {
      measured = sim.part_currents?.P1?.[x.pin!] ?? null;
      what = `current into ${x.pin}`;
    }
    const unit = x.kind === 'voltage' ? 'V' : 'A';
    // A little slack for the maths, none for the meaning.
    const slack = Math.max(Math.abs(x.max - x.min) * 0.0, 1e-9 + 1e-4 * Math.max(Math.abs(x.min), Math.abs(x.max)));
    const ok = measured != null && measured >= x.min - slack && measured <= x.max + slack;
    if (!ok) pass = false;
    detail.push(
      measured == null
        ? `${what}: pin not connected in this setup`
        : `${what} = ${fmt(measured)}${unit}, expected ${fmt(x.min)} to ${fmt(x.max)}${unit} ${ok ? '✓' : '✗'}`,
    );
  }
  return { say: check.say, pass, detail };
}

export function runChecks(def: PartDef): CheckResult[] {
  return def.checks.map((c) => runCheck(def, c));
}
