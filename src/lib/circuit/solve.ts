/**
 * DC operating-point solver: modified nodal analysis with a Newton-Raphson loop
 * for the nonlinear devices (diodes, LEDs).
 *
 * This replaces the ngspice subprocess in the original design. Running it
 * in-process is what makes the edit path (US-05) land in milliseconds instead of
 * seconds, and it removes a native binary from the deploy target.
 */

import type { CircuitComponent, CircuitGraph, ComponentResult, Net, Simulation } from '../types';
import { LED_VF, parseValue } from './units';
import { BOARDS, isBoardType, type PinState } from './boards';

/** Conductance added from every node to ground so floating sub-graphs stay solvable. */
const GMIN = 1e-9;
/**
 * Battery internal resistance, by nominal voltage. A 9V PP3 is around 1.7 ohm and
 * a single alkaline cell around 0.3; this is what actually sets the current when
 * a beginner puts an LED straight across a battery, so it is not a fudge factor.
 */
const batteryRint = (v: number) => (v >= 7 ? 1.7 : v >= 3 ? 0.5 : 0.3);
/** Current at which a datasheet quotes an LED's forward voltage. */
const IREF = 0.02;
const R_CLOSED_SWITCH = 1e-3;
const R_OPEN_SWITCH = 1e9;
const MAX_ITER = 200;
const V_TOL = 1e-7;
const I_TOL = 1e-11;

export interface DeviceModel {
  /** Saturation current. */
  is: number;
  /** Effective thermal voltage, n * Vt. Sets the slope of the knee. */
  vt: number;
  /** Bulk series resistance. For an LED this is what limits current above the knee. */
  rs: number;
}

export function diodeModel(c: CircuitComponent): DeviceModel {
  if (c.type === 'led') {
    const colour = (c.value ?? 'red').toLowerCase().trim();
    const explicit = parseValue(c.value);
    const vf = explicit != null && explicit > 0.5 && explicit < 6 ? explicit : (LED_VF[colour] ?? 2.0);
    const vt = 0.06;
    const rs = 15;
    // The quoted Vf includes the drop across rs at the reference current, so the
    // junction itself sits that much lower.
    const vj = Math.max(vf - IREF * rs, 0.4);
    return { is: IREF * Math.exp(-vj / vt), vt, rs };
  }
  return { is: 1e-14, vt: 0.02585, rs: 0.01 };
}

/** Defaults used when the sketch carries no readable value. Rules report these. */
export function defaultValue(c: CircuitComponent): number | null {
  const v = parseValue(c.value);
  if (v != null && v > 0) return v;
  switch (c.type) {
    case 'resistor': return 1000;
    case 'battery': return 9;
    case 'capacitor': return 100e-9;
    case 'capacitor_electrolytic': return 10e-6;
    case 'inductor': return 1e-3;
    case 'potentiometer': return 10000;
    case 'buzzer': return 100;
    case 'motor': return 10;
    default: return null;
  }
}

/** True when the component carried no usable value and the solver substituted one. */
export function valueAssumed(c: CircuitComponent): boolean {
  if (c.type === 'led' || c.type === 'ground' || c.type === 'junction') return false;
  const v = parseValue(c.value);
  return !(v != null && v > 0);
}

// ---------------------------------------------------------------- linear algebra

/** Solves A x = b in place by Gaussian elimination with partial pivoting. */
function luSolve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  if (n === 0) return [];
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-18) return null;
    if (piv !== col) [M[col], M[piv]] = [M[piv], M[col]];
    const d = M[col][col];
    for (let r = col + 1; r < n; r++) {
      const f = M[r][col] / d;
      if (f === 0) continue;
      for (let k = col; k <= n; k++) M[r][k] -= f * M[col][k];
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i][n];
    for (let k = i + 1; k < n; k++) s -= M[i][k] * x[k];
    x[i] = s / M[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}

/**
 * SPICE's pnjlim: damps the Newton step across a diode junction so an exponential
 * does not overflow on the way to the solution.
 */
function limitJunction(vNew: number, vOld: number, vt: number, vcrit: number): number {
  if (vNew > vcrit && Math.abs(vNew - vOld) > 2 * vt) {
    if (vOld > 0) {
      const arg = 1 + (vNew - vOld) / vt;
      return arg > 0 ? vOld + vt * Math.log(arg) : vcrit;
    }
    return vt * Math.log(vNew / vt);
  }
  return vNew;
}

// ---------------------------------------------------------------- topology

export interface Topology {
  /** net id -> node index; ground is 0. */
  nodeOf: Map<string, number>;
  /** "comp.pin" -> node index. */
  pinNode: Map<string, number>;
  nodeCount: number;
  groundNet: string | null;
}

export function buildTopology(graph: CircuitGraph): Topology {
  const nodeOf = new Map<string, number>();
  const pinNode = new Map<string, number>();

  // Ground preference: an explicit ground net, then a net touching a ground
  // symbol, then a board's GND pin, then the battery's negative terminal.
  const groundSymbols = new Set(
    graph.components.filter((c) => c.type === 'ground').map((c) => `${c.id}.gnd`),
  );
  let groundNet: Net | undefined = graph.nets.find((n) => n.is_ground);
  groundNet ??= graph.nets.find((n) => n.pins.some((p) => groundSymbols.has(p)));
  if (!groundNet) {
    for (const b of graph.components.filter((c) => isBoardType(c.type))) {
      const n = graph.nets.find((net) => net.pins.includes(`${b.id}.GND`) && net.pins.length > 1);
      if (n) { groundNet = n; break; }
    }
  }
  if (!groundNet) {
    const batteries = graph.components.filter((c) => c.type === 'battery');
    for (const b of batteries) {
      const n = graph.nets.find((net) => net.pins.includes(`${b.id}.neg`));
      if (n) { groundNet = n; break; }
    }
  }
  groundNet ??= graph.nets[0];

  if (groundNet) nodeOf.set(groundNet.id, 0);
  let next = 1;
  for (const net of graph.nets) if (!nodeOf.has(net.id)) nodeOf.set(net.id, next++);
  for (const net of graph.nets) {
    const node = nodeOf.get(net.id)!;
    for (const pin of net.pins) pinNode.set(pin, node);
  }
  return { nodeOf, pinNode, nodeCount: next, groundNet: groundNet?.id ?? null };
}

// ---------------------------------------------------------------- the solver

interface Branch { comp: CircuitComponent; index: number }

/** A board pin as a voltage `emf` behind `r` ohms, between two nodes. */
interface NortonSource { id: string; pin: string; np: number; nn: number; emf: number; r: number }

/**
 * What a board is doing, expressed as sources.
 *
 * Supply pins are always on. A GPIO is driven according to its state, and where
 * nothing says what that is the assumption is HIGH: it is the state in which an
 * LED hung on a pin or a load that is too heavy does damage, which is the
 * question the person is asking. The exception is a pin that shares its net with
 * a pin of another board — two outputs fighting over a wire is not a design, it
 * is a mistake in how this was read, so every board after the first listens.
 *
 * A board whose GND is not connected delivers nothing, since a source with no
 * return path has no current to give.
 */
/**
 * What a pin is assumed to be doing when nothing says. HIGH, unless it shares a
 * wire with a pin of an earlier board, in which case it listens. The interface
 * shows this same answer, so what is selected there is what was solved.
 */
export function defaultPinState(graph: CircuitGraph, boardId: string, pin: string): PinState {
  const boards = graph.components.filter((c) => isBoardType(c.type));
  const order = boards.findIndex((b) => b.id === boardId);
  const ref = `${boardId}.${pin}`;
  const net = graph.nets.find((n) => n.pins.includes(ref));
  const sharesWithEarlierBoard = net?.pins.some((other) => {
    const owner = other.slice(0, other.lastIndexOf('.'));
    const at = boards.findIndex((b) => b.id === owner);
    return owner !== boardId && at >= 0 && at < order;
  }) ?? false;
  return sharesWithEarlierBoard ? 'input' : 'high';
}

export function boardSources(graph: CircuitGraph, node: (pin: string) => number): NortonSource[] {
  const out: NortonSource[] = [];
  const boards = graph.components.filter((c) => isBoardType(c.type));
  const netOfPin = new Map<string, Net>();
  for (const net of graph.nets) for (const pin of net.pins) netOfPin.set(pin, net);

  boards.forEach((board) => {
    if (!isBoardType(board.type)) return;
    const spec = BOARDS[board.type];
    const nn = node(`${board.id}.GND`);
    if (nn < 0) return;

    for (const [pin, p] of Object.entries(spec.power)) {
      const np = node(`${board.id}.${pin}`);
      if (np >= 0 && (netOfPin.get(`${board.id}.${pin}`)?.pins.length ?? 0) > 1) {
        out.push({ id: board.id, pin, np, nn, emf: p.volts, r: p.rint });
      }
    }

    for (const pin of spec.gpio) {
      const ref = `${board.id}.${pin}`;
      const net = netOfPin.get(ref);
      const np = node(ref);
      if (np < 0 || !net || net.pins.length < 2) continue;

      const state: PinState = board.pin_states?.[pin] ?? defaultPinState(graph, board.id, pin);
      if (state === 'input') continue;
      out.push({ id: board.id, pin, np, nn, emf: state === 'high' ? spec.logicV : 0, r: spec.gpioRout });
    }
  });
  return out;
}

export function solveDC(graph: CircuitGraph): Simulation {
  const empty: Simulation = { status: 'unsimulatable', node_voltages: {}, component_results: {}, reason: '' };
  if (graph.nets.length === 0) return { ...empty, reason: 'No connections were recovered, so there is nothing to solve.' };

  const topo = buildTopology(graph);
  const comps = graph.components;
  const sources = comps.filter((c) => c.type === 'battery');

  const node = (pin: string): number => topo.pinNode.get(pin) ?? -1;
  const nd = (n: number) => n;

  const nortons = boardSources(graph, node);
  if (sources.length === 0 && nortons.length === 0) {
    return { ...empty, status: 'no_source', reason: 'No power source was found, so every node sits at 0V.' };
  }

  const nonlinear = comps.filter((c) => c.type === 'led' || c.type === 'diode');

  /**
   * Unknown vector layout:
   *   [0 .. netNodes-1]            net voltages, ground excluded
   *   [netNodes .. +nonlinear-1]   one internal node per diode, between its
   *                                junction and its bulk resistance
   *   [.. +sources-1]              one current per voltage-source branch
   */
  const netNodes = topo.nodeCount - 1;
  const internalOf = new Map<string, number>();
  nonlinear.forEach((d, i) => internalOf.set(d.id, topo.nodeCount + i));
  const nNodes = netNodes + nonlinear.length;
  const branches: Branch[] = sources.map((comp, i) => ({ comp, index: nNodes + i }));
  const size = nNodes + branches.length;
  if (size === 0) return { ...empty, reason: 'The circuit collapses to a single node.' };

  const v = new Array<number>(size).fill(0);
  // Seed nonlinear devices near their knee so Newton starts in a sane place.
  const prevJunction = new Map<string, number>();
  for (const d of nonlinear) {
    const m = diodeModel(d);
    prevJunction.set(d.id, m.vt * Math.log(1e-3 / m.is));
  }

  let iterations = 0;
  let converged = false;
  let last = [...v];

  for (let iter = 0; iter < MAX_ITER; iter++) {
    iterations = iter + 1;
    let limitedThisIter = false;
    const A: number[][] = Array.from({ length: size }, () => new Array<number>(size).fill(0));
    const b = new Array<number>(size).fill(0);

    // A pin that belongs to no net is an open circuit, not a connection to ground.
    // Skipping the stamp is what makes a floating branch carry no current.
    const stampG = (n1: number, n2: number, g: number) => {
      if (!Number.isFinite(g) || n1 < 0 || n2 < 0) return;
      if (n1 > 0) A[n1 - 1][n1 - 1] += g;
      if (n2 > 0) A[n2 - 1][n2 - 1] += g;
      if (n1 > 0 && n2 > 0) { A[n1 - 1][n2 - 1] -= g; A[n2 - 1][n1 - 1] -= g; }
    };
    const stampI = (n1: number, n2: number, i: number) => {
      if (n1 < 0 || n2 < 0) return;
      // Current i flowing from n1 to n2 through the device.
      if (n1 > 0) b[n1 - 1] -= i;
      if (n2 > 0) b[n2 - 1] += i;
    };
    const nodeV = (n: number) => (n > 0 ? v[n - 1] : 0);

    // gmin to ground everywhere: keeps the matrix non-singular when a branch floats.
    for (let n = 1; n <= nNodes; n++) stampG(n, 0, GMIN);

    // A board pin is a voltage behind a resistance. As a Norton equivalent — a
    // conductance with a current source across it — it needs no extra unknown, so
    // it drops into the same matrix as everything else.
    for (const src of nortons) {
      const g = 1 / src.r;
      stampG(src.np, src.nn, g);
      stampI(src.nn, src.np, src.emf * g);
    }

    for (const c of comps) {
      const val = defaultValue(c);
      switch (c.type) {
        case 'resistor': {
          const r = Math.max(val ?? 1000, 1e-6);
          stampG(nd(node(`${c.id}.a`)), nd(node(`${c.id}.b`)), 1 / r);
          break;
        }
        case 'potentiometer': {
          const r = Math.max(val ?? 10000, 1e-6);
          const frac = 0.5;
          stampG(node(`${c.id}.a`), node(`${c.id}.wiper`), 1 / Math.max(r * frac, 1e-6));
          stampG(node(`${c.id}.wiper`), node(`${c.id}.b`), 1 / Math.max(r * (1 - frac), 1e-6));
          break;
        }
        case 'buzzer': stampG(node(`${c.id}.pos`), node(`${c.id}.neg`), 1 / Math.max(val ?? 100, 1e-6)); break;
        case 'motor': stampG(node(`${c.id}.a`), node(`${c.id}.b`), 1 / Math.max(val ?? 10, 1e-6)); break;
        case 'inductor': stampG(node(`${c.id}.a`), node(`${c.id}.b`), 1 / R_CLOSED_SWITCH); break;
        case 'crystal': case 'header': break;
        case 'switch': {
          const closed = (c.value ?? 'closed').toLowerCase() !== 'open';
          stampG(node(`${c.id}.a`), node(`${c.id}.b`), 1 / (closed ? R_CLOSED_SWITCH : R_OPEN_SWITCH));
          break;
        }
        case 'capacitor': case 'capacitor_electrolytic':
          // Open circuit at DC; the leak keeps both plates referenced.
          stampG(node(`${c.id}.${c.type === 'capacitor' ? 'a' : 'pos'}`),
                 node(`${c.id}.${c.type === 'capacitor' ? 'b' : 'neg'}`), 1e-12);
          break;
        case 'led': case 'diode': {
          const m = diodeModel(c);
          const na = node(`${c.id}.anode`);
          const nc = node(`${c.id}.cathode`);
          const ni = internalOf.get(c.id)!;
          const vcrit = m.vt * Math.log(m.vt / (Math.SQRT2 * m.is));
          const vRaw = nodeV(na) - nodeV(ni);
          const vd = limitJunction(vRaw, prevJunction.get(c.id) ?? 0, m.vt, vcrit);
          if (Math.abs(vd - vRaw) > V_TOL) limitedThisIter = true;
          prevJunction.set(c.id, vd);
          const ex = Math.exp(Math.min(vd / m.vt, 80));
          const id = m.is * (ex - 1);
          const gd = (m.is / m.vt) * ex + GMIN;
          // Companion model: conductance gd plus a current source of (id - gd*vd),
          // then the bulk resistance from the internal node to the cathode.
          stampG(na, ni, gd);
          stampI(na, ni, id - gd * vd);
          stampG(ni, nc, 1 / m.rs);
          break;
        }
        case 'battery': {
          const br = branches.find((x) => x.comp.id === c.id)!;
          const np = node(`${c.id}.pos`);
          const nn = node(`${c.id}.neg`);
          const k = br.index;
          const emf = val ?? 9;
          if (np < 0 || nn < 0) {
            // A terminal hanging in mid-air: the source delivers nothing.
            A[k][k] = 1;
            b[k] = 0;
            break;
          }
          // v(np) - v(nn) - Rint * i = V
          if (np > 0) { A[np - 1][k] += 1; A[k][np - 1] += 1; }
          if (nn > 0) { A[nn - 1][k] -= 1; A[k][nn - 1] -= 1; }
          A[k][k] -= batteryRint(emf);
          b[k] = emf;
          break;
        }
        default: break; // ground, junction, transistor, ic, unknown: no DC stamp
      }
    }

    const x = luSolve(A, b);
    if (!x) {
      return { ...empty, reason: 'The circuit has no solvable operating point — usually a short across the supply or a node connected to nothing.' };
    }
    let dvMax = 0;
    for (let i = 0; i < size; i++) {
      const d = Math.abs(x[i] - v[i]);
      if (i < nNodes) dvMax = Math.max(dvMax, d);
      else if (d > I_TOL) dvMax = Math.max(dvMax, Math.min(d, 1));
      v[i] = x[i];
    }
    last = [...v];
    if (nonlinear.length === 0) { converged = true; break; }
    // A device whose Newton step was damped is still travelling, however little
    // the node voltages moved. Without this the loop declares victory early.
    if (iter > 0 && dvMax < V_TOL && !limitedThisIter) { converged = true; break; }
  }

  if (!converged) {
    return { ...empty, reason: 'The operating point did not converge. The circuit may be unstable or contain a conflicting connection.' };
  }

  // ------------------------------------------------------------ read out results
  const node_voltages: Record<string, number> = {};
  for (const [netId, n] of topo.nodeOf) node_voltages[netId] = n === 0 ? 0 : last[n - 1];
  // Internal diode nodes are an implementation detail and are not reported.

  const nodeV = (n: number) => (n > 0 ? last[n - 1] : 0);
  const component_results: Record<string, ComponentResult> = {};
  const record = (id: string, i: number, vv: number) => {
    component_results[id] = { current_a: i, voltage_v: vv, power_w: Math.abs(i * vv) };
  };

  // What each board pin is actually delivering, now the voltages are known.
  const pin_currents: Record<string, number> = {};
  for (const src of nortons) {
    const dv = nodeV(src.np) - nodeV(src.nn);
    pin_currents[`${src.id}.${src.pin}`] = (src.emf - dv) / src.r;
  }
  for (const c of comps) {
    if (!isBoardType(c.type)) continue;
    const power = Object.keys(BOARDS[c.type].power);
    const own = nortons.filter((n) => n.id === c.id);
    const supply = own.filter((n) => power.includes(n.pin));
    const delivered = supply.reduce((a, n) => a + pin_currents[`${n.id}.${n.pin}`], 0);
    const rail = supply[0] ? nodeV(supply[0].np) - nodeV(supply[0].nn) : 0;
    component_results[c.id] = {
      current_a: delivered,
      voltage_v: rail,
      power_w: own.reduce((a, n) => a + Math.max(0, pin_currents[`${n.id}.${n.pin}`]) * n.emf, 0),
    };
  }

  for (const c of comps) {
    if (isBoardType(c.type)) continue;
    const val = defaultValue(c);
    // A device with a lead in mid-air carries nothing, so it drops nothing. Reading
    // the node voltages directly would otherwise invent a current through it.
    if (c.pins.some((p) => node(`${c.id}.${p}`) < 0)) { record(c.id, 0, 0); continue; }
    switch (c.type) {
      case 'resistor': {
        const r = Math.max(val ?? 1000, 1e-6);
        const vv = nodeV(node(`${c.id}.a`)) - nodeV(node(`${c.id}.b`));
        record(c.id, vv / r, vv);
        break;
      }
      case 'led': case 'diode': {
        const m = diodeModel(c);
        const ni = internalOf.get(c.id)!;
        const vj = nodeV(node(`${c.id}.anode`)) - nodeV(ni);
        const vv = nodeV(node(`${c.id}.anode`)) - nodeV(node(`${c.id}.cathode`));
        const i = m.is * (Math.exp(Math.min(vj / m.vt, 80)) - 1);
        record(c.id, i, vv);
        break;
      }
      case 'battery': {
        const br = branches.find((x) => x.comp.id === c.id)!;
        const i = last[br.index];
        const emf = val ?? 9;
        const vv = nodeV(node(`${c.id}.pos`)) - nodeV(node(`${c.id}.neg`));
        // Branch current is defined into the positive terminal; report delivered
        // current, and power against the EMF so a dead short reads as the heat it is.
        component_results[c.id] = { current_a: -i, voltage_v: vv, power_w: Math.abs(i * emf) };
        break;
      }
      case 'switch': {
        const closed = (c.value ?? 'closed').toLowerCase() !== 'open';
        const vv = nodeV(node(`${c.id}.a`)) - nodeV(node(`${c.id}.b`));
        record(c.id, vv / (closed ? R_CLOSED_SWITCH : R_OPEN_SWITCH), vv);
        break;
      }
      case 'capacitor': case 'capacitor_electrolytic': {
        const pa = c.type === 'capacitor' ? 'a' : 'pos';
        const pb = c.type === 'capacitor' ? 'b' : 'neg';
        record(c.id, 0, nodeV(node(`${c.id}.${pa}`)) - nodeV(node(`${c.id}.${pb}`)));
        break;
      }
      case 'buzzer': case 'motor': case 'inductor': case 'potentiometer': {
        const [pa, pb] = c.type === 'buzzer' ? ['pos', 'neg'] : ['a', 'b'];
        const r = c.type === 'inductor' ? R_CLOSED_SWITCH : Math.max(val ?? 100, 1e-6);
        const vv = nodeV(node(`${c.id}.${pa}`)) - nodeV(node(`${c.id}.${pb}`));
        record(c.id, vv / r, vv);
        break;
      }
      default: record(c.id, 0, 0);
    }
  }

  return { status: 'ok', node_voltages, component_results, iterations, pin_currents };
}
