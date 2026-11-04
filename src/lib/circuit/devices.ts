/**
 * The device primitives a described part is made of.
 *
 * Each device reports, for the node voltages it is given, the current flowing
 * into each of its terminals and how those currents change with the voltages (the
 * Jacobian). The solver linearises every device the same way, so adding a device
 * means writing one function rather than touching the matrix code.
 *
 * Voltage-limiting is what keeps an exponential from overflowing on the way to
 * its solution; a device that limits a step also says where it linearised, so the
 * stamp is consistent with the voltage it actually used.
 */

import type { PartDef, Element } from './partdef';
import { resolveNum } from './partdef';

const GMIN = 1e-12;
/** Closed contact and open gap, ohms. */
export const R_ON = 0.01;
export const R_OFF = 1e9;
/** Output resistance of an op-amp's final stage. */
const OPAMP_ROUT = 50;
const OPAMP_HEADROOM_HI = 1.5;
const OPAMP_HEADROOM_LO = 0.05;
const IREF = 0.02;

export interface Eval {
  /** Current into each terminal, in the order of the device's nodes. */
  I: number[];
  /** dI_k / dV_j. */
  J: number[][];
  /** The node voltages the linearisation is about, after any limiting. */
  v0: number[];
  /** True when the step was damped, so the solution is not final yet. */
  limited: boolean;
}

export interface Device {
  /** A stable name, for diagnostics. */
  tag: string;
  /** Node indices of the terminals; 0 is ground. */
  nodes: number[];
  eval(v: number[], state: Map<string, number>, final: boolean, gain: number): Eval;
  /** Whether the device needs Newton iterations or a state commit. */
  nonlinear: boolean;
  /** The part-local node name behind each terminal, or '' for a hidden node. */
  names?: string[];
}

function pnjlim(vNew: number, vOld: number, vt: number, vcrit: number): number {
  if (vNew > vcrit && Math.abs(vNew - vOld) > 2 * vt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / vt;
      return arg > 0 ? vOld + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vNew / vt);
  }
  return vNew;
}

// ------------------------------------------------------------------ primitives

export function resistorDevice(tag: string, a: number, b: number, ohms: number): Device {
  const g = 1 / Math.max(ohms, 1e-6);
  return {
    tag, nodes: [a, b], nonlinear: false,
    eval: (v) => ({
      I: [g * (v[0] - v[1]), -g * (v[0] - v[1])],
      J: [[g, -g], [-g, g]],
      v0: v,
      limited: false,
    }),
  };
}

/**
 * i = is * (exp((v - off) / vt) - 1) from n1 to n2, with v = V(n1) - V(n2).
 * `sub1` false drops the -1, which is what a breakdown wants: it carries nothing
 * until its threshold rather than leaking in reverse from the start.
 */
export function junctionDevice(
  tag: string, n1: number, n2: number,
  m: { is: number; vt: number; off: number; sub1: boolean },
): Device {
  const vcrit = m.vt * Math.log(m.vt / (Math.SQRT2 * m.is));
  return {
    tag, nodes: [n1, n2], nonlinear: true,
    eval: (v, state, final) => {
      const raw = v[0] - v[1] - m.off;
      const key = `${tag}:vd`;
      const prev = state.get(key) ?? 0;
      const vd = final ? raw : pnjlim(raw, prev, m.vt, vcrit);
      if (!final) state.set(key, vd);
      const ex = Math.exp(Math.min(vd / m.vt, 80));
      const id = m.is * (m.sub1 ? ex - 1 : ex);
      const gd = (m.is / m.vt) * ex + GMIN;
      return {
        I: [id, -id],
        J: [[gd, -gd], [-gd, gd]],
        // Linearised where the limited voltage is: move the first node to it.
        v0: final ? v : [v[1] + vd + m.off, v[1]],
        limited: !final && Math.abs(vd - raw) > 1e-7,
      };
    },
  };
}

/** Voltage-controlled contact: closed when the control voltage passes the threshold. */
export function vswitchDevice(
  tag: string, a: number, b: number, cp: number, cn: number,
  threshold: number, closedAbove: boolean,
): Device {
  return {
    tag, nodes: [a, b, cp, cn], nonlinear: true,
    eval: (v, state) => {
      const ctl = v[2] - v[3];
      const key = `${tag}:closed`;
      // The decision is made from the previous pass, with a gap between pulling
      // in and dropping out, so a coil sitting on its threshold does not chatter.
      const was = state.get(key);
      const dropout = threshold - Math.abs(threshold) * 0.4;
      const above = was === 1 ? ctl >= dropout : ctl >= threshold;
      const closed = closedAbove ? above : !above;
      state.set(`${tag}:next`, closed ? 1 : 0);
      const g = 1 / (closed ? R_ON : R_OFF);
      const dv = v[0] - v[1];
      return {
        I: [g * dv, -g * dv, 0, 0],
        J: [[g, -g, 0, 0], [-g, g, 0, 0], [0, 0, 0, 0], [0, 0, 0, 0]],
        v0: v,
        limited: false,
      };
    },
  };
}

/** Called after each pass: commits the switch decisions; true if any changed. */
export function commitSwitches(devices: Device[], state: Map<string, number>): boolean {
  let changed = false;
  for (const d of devices) {
    const next = state.get(`${d.tag}:next`);
    if (next === undefined) continue;
    if (state.get(`${d.tag}:closed`) !== next) changed = true;
    state.set(`${d.tag}:closed`, next);
  }
  return changed;
}

/** Ebers-Moll transport model. Terminals: collector, base, emitter. */
export function bjtDevice(
  tag: string, c: number, b: number, e: number,
  polarity: 'npn' | 'pnp', beta: number,
): Device {
  const s = polarity === 'npn' ? 1 : -1;
  const IS = 1e-14;
  const VT = 0.02585;
  const BR = 2;
  const vcrit = VT * Math.log(VT / (Math.SQRT2 * IS));
  return {
    tag, nodes: [c, b, e], nonlinear: true,
    eval: (v, state, final) => {
      // As an NPN: work in s*v, then flip the currents back.
      const vc = s * v[0], vb = s * v[1], ve = s * v[2];
      const rawBE = vb - ve;
      const rawBC = vb - vc;
      const pBE = state.get(`${tag}:be`) ?? 0;
      const pBC = state.get(`${tag}:bc`) ?? 0;
      const ube = final ? rawBE : pnjlim(rawBE, pBE, VT, vcrit);
      const ubc = final ? rawBC : pnjlim(rawBC, pBC, VT, vcrit);
      if (!final) { state.set(`${tag}:be`, ube); state.set(`${tag}:bc`, ubc); }
      const ef = Math.exp(Math.min(ube / VT, 80));
      const er = Math.exp(Math.min(ubc / VT, 80));
      const If = IS * (ef - 1);
      const Ir = IS * (er - 1);
      const gf = (IS / VT) * ef + GMIN;
      const gr = (IS / VT) * er + GMIN;
      // Terminal currents into the device (NPN sign): collector, base, emitter.
      const Ic = If - Ir - Ir / BR;
      const Ib = If / beta + Ir / BR;
      const Ie = -(Ic + Ib);
      // Partials with respect to u1 = vbe and u2 = vbc.
      const dIc = [gf, -gr - gr / BR];
      const dIb = [gf / beta, gr / BR];
      const dIe = [-(dIc[0] + dIb[0]), -(dIc[1] + dIb[1])];
      // du1/d(vc,vb,ve) = (0, 1, -1); du2/d(vc,vb,ve) = (-1, 1, 0).
      const row = (d: number[]) => [-d[1], d[0] + d[1], -d[0]];
      const J = [row(dIc), row(dIb), row(dIe)];
      const limited = !final && (Math.abs(ube - rawBE) > 1e-7 || Math.abs(ubc - rawBC) > 1e-7);
      // Linearisation point that reproduces the limited junction voltages.
      const vb0 = vb;
      const ve0 = vb0 - ube;
      const vc0 = vb0 - ubc;
      return {
        I: [s * Ic, s * Ib, s * Ie],
        J,
        v0: final ? v : [s * vc0, s * vb0, s * ve0],
        limited,
      };
    },
  };
}

/** Level-1 square-law MOSFET. Terminals: drain, gate, source. */
export function mosfetDevice(
  tag: string, d: number, g: number, sNode: number,
  polarity: 'n' | 'p', vth: number, k: number,
): Device {
  const s = polarity === 'n' ? 1 : -1;
  const f = (vgs: number, vds: number) => {
    const vov = vgs - vth;
    if (vov <= 0) return { id: 0, gm: 0, gds: 1e-12 };
    if (vds < vov) return { id: k * (vov * vds - (vds * vds) / 2), gm: k * vds, gds: k * (vov - vds) + 1e-12 };
    return { id: (k / 2) * vov * vov, gm: k * vov, gds: 1e-12 };
  };
  return {
    tag, nodes: [d, g, sNode], nonlinear: true,
    eval: (v, state, final) => {
      const vd = s * v[0], vg = s * v[1], vs = s * v[2];
      // Limit the gate step, so a start far from the answer does not throw the
      // square law across its whole range in one iteration.
      let limited = false;
      let shiftG = 0;
      if (!final) {
        const prev = state.get(`${tag}:vgs`);
        const raw = vg - vs;
        const lim = prev === undefined ? raw : Math.max(prev - 1.5, Math.min(prev + 1.5, raw));
        if (Math.abs(lim - raw) > 1e-9) { shiftG = lim - raw; limited = true; }
        state.set(`${tag}:vgs`, lim);
      }
      const vgEff = vg + shiftG;
      const swapped = vd < vs;
      let Id: number;
      let J: number[][];
      if (!swapped) {
        const r = f(vgEff - vs, vd - vs);
        Id = r.id;
        // dI_d: vd -> gds, vg -> gm, vs -> -(gm+gds)
        const rowD = [r.gds, r.gm, -(r.gm + r.gds)];
        J = [rowD, [0, 0, 0], rowD.map((x) => -x)];
      } else {
        const r = f(vgEff - vd, vs - vd);
        Id = -r.id;
        // drain current is -id', with the roles of drain and source exchanged.
        const rowD = [r.gm + r.gds, -r.gm, -r.gds];
        J = [rowD, [0, 0, 0], rowD.map((x) => -x)];
      }
      const I = [s * Id, 0, -s * Id];
      return {
        I,
        J,
        v0: final ? v : [v[0], s * vgEff, v[2]],
        limited,
      };
    },
  };
}

/**
 * An op-amp: a soft-limited, high-gain voltage source behind the output
 * resistance. The inputs draw nothing; the supply pins set how far the output may
 * swing. `gain` is ramped by the solver so a start far from the answer cannot
 * leave it stuck on a rail.
 */
export function opampDevice(
  tag: string, out: number, inp: number, inn: number, vcc: number, vee: number,
): Device {
  return {
    tag, nodes: [out, inp, inn, vcc, vee], nonlinear: true,
    eval: (v, state, final, gain) => {
      const hi = v[3] - OPAMP_HEADROOM_HI;
      const lo = v[4] + OPAMP_HEADROOM_LO;
      const raw = v[1] - v[2];
      const g = 1 / OPAMP_ROUT;
      if (hi - lo < 0.2) {
        // Not powered: the output rests at the negative supply.
        return { I: [g * (v[0] - v[4]), 0, 0, 0, 0], J: [[g, 0, 0, 0, 0], ...Array.from({ length: 4 }, () => [0, 0, 0, 0, 0])], v0: v, limited: false };
      }
      const half = (hi - lo) / 2;
      const mid = (hi + lo) / 2;
      // The curve is concave on one side, so a full Newton step from deep in
      // saturation lands on the wrong side of the answer and rings. Moving the
      // differential input by no more than a few linear widths per pass stops it.
      let vd = raw;
      if (!final) {
        const prev = state.get(`${tag}:vd`);
        if (prev !== undefined) {
          const reach = (4 * half) / gain;
          vd = Math.max(prev - reach, Math.min(prev + reach, raw));
        }
        state.set(`${tag}:vd`, vd);
      }
      const x = (gain * vd) / half;
      const emf = mid + half * (x / (1 + Math.abs(x)));
      // True slope, floored for the step only: in saturation it vanishes and a
      // step divided by it flies to the other rail. The current is exact, so the
      // answer does not move.
      const dEmf = Math.max(gain / ((1 + Math.abs(x)) ** 2), Math.min(gain, 1));
      const row = [g, -g * dEmf, g * dEmf, 0, 0];
      return {
        I: [g * (v[0] - emf), 0, 0, 0, 0],
        J: [row, ...Array.from({ length: 4 }, () => [0, 0, 0, 0, 0])],
        v0: final ? v : [v[0], v[1] - (raw - vd), v[2], v[3], v[4]],
        limited: !final && Math.abs(vd - raw) > 1e-9,
      };
    },
  };
}

// ------------------------------------------------------------ source elements

export interface VSource { tag: string; np: number; nn: number; volts: number; rint: number; pins: [string, string] }
export interface ISource { tag: string; from: number; to: number; amps: number; pins: [string, string] }

export interface Expanded {
  devices: Device[];
  vsources: VSource[];
  isources: ISource[];
  /** Pin name -> node index, for reading results back. */
  pinNodes: Map<string, number>;
  /** Which element each device or source belongs to, for attributing currents. */
  hasOpamp: boolean;
}

/**
 * Lays a part's elements onto solver nodes.
 *
 * `node(name)` resolves a pin or internal node to an index, allocating one where
 * the pin is wired to nothing, so a floating pin floats rather than being tied to
 * ground. `fresh()` hands out the hidden nodes diodes need for their series
 * resistance.
 */
export function expandPart(
  id: string,
  def: PartDef,
  value: number | null,
  node: (name: string) => number,
  fresh: () => number,
): Expanded {
  const devices: Device[] = [];
  const vsources: VSource[] = [];
  const isources: ISource[] = [];
  let hasOpamp = false;
  const num = (n: number | 'value') => resolveNum(n, def, value);

  const add = (d: Device, names: string[]) => { d.names = names; devices.push(d); };

  def.elements.forEach((e: Element, i: number) => {
    const tag = `${id}#${i}`;
    switch (e.kind) {
      case 'resistor':
        add(resistorDevice(tag, node(e.a), node(e.b), num(e.ohms)), [e.a, e.b]);
        break;
      case 'diode': {
        const vt = e.vf > 1.2 ? 0.06 : 0.02585;
        const vj = Math.max(e.vf - IREF * e.rs, 0.2);
        const mid = fresh();
        add(junctionDevice(`${tag}j`, node(e.a), mid, { is: IREF * Math.exp(-vj / vt), vt, off: 0, sub1: true }), [e.a, '']);
        add(resistorDevice(`${tag}r`, mid, node(e.k), e.rs), ['', e.k]);
        break;
      }
      case 'zener': {
        const mid = fresh();
        const a = node(e.a);
        const vj = 0.7 - IREF * e.rs;
        add(junctionDevice(`${tag}f`, a, mid, { is: IREF * Math.exp(-vj / 0.02585), vt: 0.02585, off: 0, sub1: true }), [e.a, '']);
        // Breakdown: reaches 5 mA at vz, from the cathode side towards the anode.
        add(junctionDevice(`${tag}z`, mid, a, { is: 0.005, vt: 0.05, off: e.vz, sub1: false }), ['', e.a]);
        add(resistorDevice(`${tag}r`, mid, node(e.k), e.rs), ['', e.k]);
        break;
      }
      case 'vsource':
        vsources.push({ tag, np: node(e.p), nn: node(e.n), volts: num(e.volts), rint: e.rint, pins: [e.p, e.n] });
        break;
      case 'isource':
        isources.push({ tag, from: node(e.from), to: node(e.to), amps: num(e.amps), pins: [e.from, e.to] });
        break;
      case 'switch':
        add(resistorDevice(tag, node(e.a), node(e.b), num(e.closed) >= 0.5 ? R_ON : R_OFF), [e.a, e.b]);
        break;
      case 'vswitch':
        add(vswitchDevice(tag, node(e.a), node(e.b), node(e.cp), node(e.cn), num(e.threshold), e.closed_above), [e.a, e.b, e.cp, e.cn]);
        break;
      case 'bjt':
        add(bjtDevice(tag, node(e.c), node(e.b), node(e.e), e.polarity, Math.max(num(e.beta), 1)), [e.c, e.b, e.e]);
        break;
      case 'mosfet':
        add(mosfetDevice(tag, node(e.d), node(e.g), node(e.s), e.polarity, num(e.vth), Math.max(num(e.k), 1e-9)), [e.d, e.g, e.s]);
        break;
      case 'opamp':
        hasOpamp = true;
        add(opampDevice(tag, node(e.out), node(e.inp), node(e.inn), node(e.vcc), node(e.vee)), [e.out, e.inp, e.inn, e.vcc, e.vee]);
        break;
    }
  });

  const pinNodes = new Map<string, number>();
  for (const p of def.pins) pinNodes.set(p.name, node(p.name));
  return { devices, vsources, isources, pinNodes, hasOpamp };
}
