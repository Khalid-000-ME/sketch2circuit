/**
 * A part described rather than drawn.
 *
 * A custom part is not a new kind of maths. It is a small network of the same
 * device primitives the solver already knows — resistors, diodes, sources,
 * switches, transistors — wired between the part's pins and a few hidden nodes
 * inside it. A relay is a coil resistor plus a switch the coil closes; a 5.1V
 * zener is a diode with a breakdown. Because the solver treats those primitives
 * exactly as it treats a drawn resistor, the part behaves as its description says
 * to the extent the primitives can say it, and no further. What they cannot say
 * is recorded in `limits`, not hidden.
 *
 * Every definition also carries behavioural checks: bench setups with expected
 * readings. They are run through the real solver before the part is accepted.
 */

import { z } from 'zod';
import type { Unit } from '../types';

/** A parameter: a literal, or the part's editable value. */
export type Num = number | 'value';

export type Element =
  | { kind: 'resistor'; a: string; b: string; ohms: Num }
  | { kind: 'diode'; a: string; k: string; vf: number; rs: number }
  | { kind: 'zener'; a: string; k: string; vz: number; rs: number }
  | { kind: 'vsource'; p: string; n: string; volts: Num; rint: number }
  | { kind: 'isource'; from: string; to: string; amps: Num }
  | { kind: 'switch'; a: string; b: string; closed: Num }
  | { kind: 'vswitch'; a: string; b: string; cp: string; cn: string; threshold: Num; closed_above: boolean }
  | { kind: 'bjt'; c: string; b: string; e: string; polarity: 'npn' | 'pnp'; beta: Num }
  | { kind: 'mosfet'; d: string; g: string; s: string; polarity: 'n' | 'p'; vth: Num; k: Num }
  | { kind: 'opamp'; inp: string; inn: string; out: string; vcc: string; vee: string };

export type PinSide = 'left' | 'right' | 'top' | 'bottom';

export interface PartPin {
  /** Lowercase, no dots: pin references are "<id>.<name>". */
  name: string;
  side: PinSide;
  /** Printed beside the pin, e.g. "COIL+". */
  label: string;
}

export type Rating =
  | { kind: 'voltage'; a: string; b: string; max: number; label: string }
  | { kind: 'current'; pin: string; max: number; label: string }
  | { kind: 'power'; max: number; label: string };

export interface Drive {
  kind: 'vsource' | 'resistor' | 'ground';
  /** vsource: pos/neg. resistor: a/b. ground: pin. Pin names of the part. */
  pos?: string;
  neg?: string;
  a?: string;
  b?: string;
  pin?: string;
  volts?: number;
  ohms?: number;
  /** vsource: resistance in series with the source, so a load can be limited. */
  rint?: number;
}

export interface Expect {
  kind: 'voltage' | 'current';
  /** voltage: from `a` to `b`; with no `b`, from `a` to the bench ground. */
  a?: string;
  b?: string;
  /** current: flowing into the part at this pin. */
  pin?: string;
  min: number;
  max: number;
}

export interface PartCheck {
  say: string;
  /** The editable value to use for this check; omitted means the default. */
  value?: number;
  drive: Drive[];
  expect: Expect[];
}

export type Fidelity = 'full' | 'dc_only' | 'approximate';

export interface PartDef {
  v: 1;
  name: string;
  prefix: string;
  summary: string;
  pins: PartPin[];
  internals: string[];
  elements: Element[];
  param: { label: string; unit: Unit; default: number } | null;
  ratings: Rating[];
  body: { colour: string; mark: string; tall: boolean };
  assumptions: string[];
  fidelity: Fidelity;
  limits: string[];
  checks: PartCheck[];
}

// ----------------------------------------------------------------------- schema

const ident = z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,11}$/, 'names are letters, digits and underscores');
const num = z.union([z.number().finite(), z.literal('value')]);
const fin = z.number().finite();

const element = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('resistor'), a: ident, b: ident, ohms: num }),
  z.object({ kind: z.literal('diode'), a: ident, k: ident, vf: fin.default(0.7), rs: fin.default(1) }),
  z.object({ kind: z.literal('zener'), a: ident, k: ident, vz: fin, rs: fin.default(2) }),
  z.object({ kind: z.literal('vsource'), p: ident, n: ident, volts: num, rint: fin.default(0) }),
  z.object({ kind: z.literal('isource'), from: ident, to: ident, amps: num }),
  z.object({ kind: z.literal('switch'), a: ident, b: ident, closed: num }),
  z.object({ kind: z.literal('vswitch'), a: ident, b: ident, cp: ident, cn: ident, threshold: num, closed_above: z.boolean().default(true) }),
  z.object({ kind: z.literal('bjt'), c: ident, b: ident, e: ident, polarity: z.enum(['npn', 'pnp']), beta: num.default(100) }),
  z.object({ kind: z.literal('mosfet'), d: ident, g: ident, s: ident, polarity: z.enum(['n', 'p']), vth: num.default(2), k: num.default(0.5) }),
  z.object({ kind: z.literal('opamp'), inp: ident, inn: ident, out: ident, vcc: ident, vee: ident }),
]);

const pin = z.object({
  name: ident,
  side: z.enum(['left', 'right', 'top', 'bottom']),
  label: z.string().max(10).optional(),
});

const rating = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('voltage'), a: ident, b: ident, max: fin.positive(), label: z.string().max(80) }),
  z.object({ kind: z.literal('current'), pin: ident, max: fin.positive(), label: z.string().max(80) }),
  z.object({ kind: z.literal('power'), max: fin.positive(), label: z.string().max(80) }),
]);

const drive = z.object({
  kind: z.enum(['vsource', 'resistor', 'ground']),
  pos: ident.optional(), neg: ident.optional(),
  a: ident.optional(), b: ident.optional(),
  pin: ident.optional(),
  volts: fin.optional(), ohms: fin.positive().optional(), rint: fin.min(0).max(1e9).optional(),
});

const expectation = z.object({
  kind: z.enum(['voltage', 'current']),
  a: ident.optional(), b: ident.optional(), pin: ident.optional(),
  min: fin, max: fin,
});

export const partSchema = z.object({
  name: z.string().min(1).max(40),
  prefix: z.string().regex(/^[A-Z]{1,3}$/),
  summary: z.string().max(240),
  pins: z.array(pin).min(1).max(10),
  internals: z.array(ident).max(6).default([]),
  elements: z.array(element).min(1).max(24),
  param: z.object({
    label: z.string().max(24),
    unit: z.enum(['ohm', 'V', 'F', 'H', 'A', 'Hz', 'W']).nullable(),
    default: fin,
  }).nullable().default(null),
  ratings: z.array(rating).max(8).default([]),
  body: z.object({
    colour: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#37474f'),
    mark: z.string().max(8).default(''),
    tall: z.boolean().default(false),
  }).default({ colour: '#37474f', mark: '', tall: false }),
  assumptions: z.array(z.string().max(200)).max(8).default([]),
  fidelity: z.enum(['full', 'dc_only', 'approximate']),
  limits: z.array(z.string().max(200)).max(8).default([]),
  checks: z.array(z.object({
    say: z.string().max(200),
    value: fin.optional(),
    drive: z.array(drive).min(1).max(8),
    expect: z.array(expectation).min(1).max(6),
  })).max(8).default([]),
});

// ------------------------------------------------------------------ validation

export interface Validated {
  ok: boolean;
  def?: PartDef;
  errors: string[];
}

const RANGES = {
  ohms: [1e-3, 1e12],
  volts: [-1000, 1000],
  amps: [-100, 100],
} as const;

/** Names of the nodes an element touches. */
export function elementNodes(e: Element): string[] {
  switch (e.kind) {
    case 'resistor': return [e.a, e.b];
    case 'diode': case 'zener': return [e.a, e.k];
    case 'vsource': return [e.p, e.n];
    case 'isource': return [e.from, e.to];
    case 'switch': return [e.a, e.b];
    case 'vswitch': return [e.a, e.b, e.cp, e.cn];
    case 'bjt': return [e.c, e.b, e.e];
    case 'mosfet': return [e.d, e.g, e.s];
    case 'opamp': return [e.inp, e.inn, e.out, e.vcc, e.vee];
  }
}

/**
 * Turns whatever the model produced into a definition the solver can trust, or a
 * list of what is wrong with it. Nothing here asks a model anything: a part that
 * refers to a pin it does not have, or a resistor of NaN ohms, is rejected with
 * the reason, so a repair attempt can be told exactly what to fix.
 */
export function validatePart(raw: unknown): Validated {
  const parsed = partSchema.safeParse(raw);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.slice(0, 8).map((i) => `${i.path.join('.') || 'part'}: ${i.message}`),
    };
  }
  const p = parsed.data;
  const errors: string[] = [];

  const pinNames = p.pins.map((x) => x.name.toLowerCase());
  if (new Set(pinNames).size !== pinNames.length) errors.push('pin names must be unique, ignoring case');
  const internals = p.internals.map((x) => x.toLowerCase());
  if (internals.some((n) => pinNames.includes(n))) errors.push('an internal node shares a name with a pin');
  const known = new Set([...pinNames, ...internals]);

  const lower = (s: string) => s.toLowerCase();
  const elements = p.elements.map((e) => {
    const out: Record<string, unknown> = { ...e };
    for (const [key, val] of Object.entries(e)) {
      if (typeof val === 'string' && key !== 'kind' && key !== 'polarity' && val !== 'value') out[key] = lower(val);
    }
    return out as unknown as Element;
  });

  elements.forEach((e, i) => {
    for (const n of elementNodes(e)) {
      if (!known.has(n)) errors.push(`element ${i + 1} (${e.kind}) uses "${n}", which is neither a pin nor an internal node`);
    }
    const bad = (cond: boolean, msg: string) => { if (cond) errors.push(`element ${i + 1} (${e.kind}): ${msg}`); };
    const lit = (n: Num) => (typeof n === 'number' ? n : null);
    if (e.kind === 'resistor') {
      const o = lit(e.ohms);
      bad(o != null && (o < RANGES.ohms[0] || o > RANGES.ohms[1]), 'ohms must be between 0.001 and 1e12');
      bad(e.a === e.b, 'both ends are the same node');
    }
    if (e.kind === 'diode') bad(e.vf < 0.2 || e.vf > 6 || e.rs < 0.001 || e.rs > 1e4, 'vf must be 0.2-6 V and rs 0.001-10000 ohm');
    if (e.kind === 'zener') bad(e.vz < 1 || e.vz > 400 || e.rs < 0.001 || e.rs > 1e4, 'vz must be 1-400 V');
    if (e.kind === 'vsource') {
      const v = lit(e.volts);
      bad(v != null && (v < RANGES.volts[0] || v > RANGES.volts[1]), 'volts out of range');
      bad(e.rint < 0 || e.rint > 1e6, 'rint out of range');
      bad(e.p === e.n, 'both terminals are the same node');
    }
    if (e.kind === 'isource') {
      const a = lit(e.amps);
      bad(a != null && (a < RANGES.amps[0] || a > RANGES.amps[1]), 'amps out of range');
    }
    if (e.kind === 'bjt') {
      const b = lit(e.beta);
      bad(b != null && (b < 1 || b > 5000), 'beta must be 1-5000');
    }
    if (e.kind === 'mosfet') {
      const k = lit(e.k);
      bad(k != null && (k <= 0 || k > 1000), 'k must be above 0 and at most 1000 A/V^2');
    }
  });

  // Only one thing may set the editable value, and it must exist if used.
  const usesValue = JSON.stringify(elements).includes('"value"');
  if (usesValue && !p.param) errors.push('an element uses "value" but the part declares no param');

  for (const r of p.ratings) {
    if (r.kind === 'voltage' && (!known.has(lower(r.a)) || !known.has(lower(r.b)))) errors.push('a voltage rating names an unknown node');
    if (r.kind === 'current' && !pinNames.includes(lower(r.pin))) errors.push('a current rating names an unknown pin');
  }
  for (const [i, c] of p.checks.entries()) {
    const pinOk = (s?: string) => s == null || pinNames.includes(lower(s));
    for (const d of c.drive) {
      if (![d.pos, d.neg, d.a, d.b, d.pin].every(pinOk)) errors.push(`check ${i + 1} drives a pin the part does not have`);
      if (d.kind === 'vsource' && (d.pos == null || d.neg == null || d.volts == null)) errors.push(`check ${i + 1} has a source without pos, neg and volts`);
      if (d.kind === 'resistor' && (d.a == null || d.b == null || d.ohms == null)) errors.push(`check ${i + 1} has a resistor without a, b and ohms`);
      if (d.kind === 'ground' && d.pin == null) errors.push(`check ${i + 1} has a ground without a pin`);
    }
    for (const x of c.expect) {
      if (![x.a, x.b, x.pin].every(pinOk)) errors.push(`check ${i + 1} expects a reading on a pin the part does not have`);
      if (x.kind === 'voltage' && x.a == null && x.pin == null) errors.push(`check ${i + 1} expects a voltage without a pin to measure`);
      if (x.kind === 'current' && x.pin == null) errors.push(`check ${i + 1} expects a current without a pin`);
      if (x.min > x.max) errors.push(`check ${i + 1} has min above max`);
    }
  }

  if (errors.length) return { ok: false, errors: errors.slice(0, 10) };

  const def: PartDef = {
    v: 1,
    name: p.name.trim(),
    prefix: p.prefix,
    summary: p.summary.trim(),
    pins: p.pins.map((x) => ({ name: lower(x.name), side: x.side, label: (x.label ?? x.name).toUpperCase() })),
    internals,
    elements,
    param: p.param,
    ratings: p.ratings.map((r) => (
      r.kind === 'voltage' ? { ...r, a: lower(r.a), b: lower(r.b) }
        : r.kind === 'current' ? { ...r, pin: lower(r.pin) } : r
    )),
    body: p.body,
    assumptions: p.assumptions,
    fidelity: p.fidelity,
    limits: p.limits,
    checks: p.checks.map((c) => ({
      ...c,
      drive: c.drive.map((d) => ({
        ...d,
        ...(d.pos ? { pos: lower(d.pos) } : {}), ...(d.neg ? { neg: lower(d.neg) } : {}),
        ...(d.a ? { a: lower(d.a) } : {}), ...(d.b ? { b: lower(d.b) } : {}),
        ...(d.pin ? { pin: lower(d.pin) } : {}),
      })),
      expect: c.expect.map((x) => ({
        ...x,
        // A voltage given on `pin` alone means that pin against the bench ground.
        ...(x.kind === 'voltage' && !x.a && x.pin ? { a: lower(x.pin), pin: undefined } : {}),
        ...(x.a ? { a: lower(x.a) } : {}), ...(x.b ? { b: lower(x.b) } : {}),
        ...(x.pin && x.kind === 'current' ? { pin: lower(x.pin) } : {}),
      })),
    })),
  };
  return { ok: true, def, errors: [] };
}

/** The value an element parameter takes for one component. */
export function resolveNum(n: Num, def: PartDef, value: number | null): number {
  if (n !== 'value') return n;
  return value != null && Number.isFinite(value) ? value : (def.param?.default ?? 0);
}
