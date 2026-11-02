/**
 * The rule-check suite. This is the product: the sentence a beginner reads.
 *
 * Every message names the component, states the physical consequence, and the
 * `fix` field gives one concrete action. No error codes, no jargon without a
 * gloss. Rules that need no simulation run even when the solver gives up, so a
 * circuit that cannot be solved still gets useful findings.
 */

import type { CircuitComponent, CircuitGraph, Finding, Simulation } from '../types';
import { defaultValue, valueAssumed } from './solve';
import { fmtA, fmtV, fmtW, formatValue, LED_VF, parseValue } from './units';

/** Typical through-hole ratings we judge against. */
const LED_MAX_MA = 20;
const RESISTOR_RATING_W = 0.25;
const BATTERY_MAX_A = 1.0;

/** E12 preferred values, so a suggested part is one that actually exists. */
const E12 = [10, 12, 15, 18, 22, 27, 33, 39, 47, 56, 68, 82];
function nearestStandard(r: number): number {
  if (!Number.isFinite(r) || r <= 0) return 330;
  for (let decade = 1; decade <= 1e6; decade *= 10) {
    for (const m of E12) {
      const v = m * decade / 10;
      if (v >= r) return v;
    }
  }
  return Math.round(r);
}

interface Ctx {
  graph: CircuitGraph;
  sim: Simulation;
  floating: string[];
  byId: Map<string, CircuitComponent>;
  netOf: Map<string, string>;
  /** component id -> connected component ids, via shared nets. */
  neighbours: Map<string, Set<string>>;
}

function label(c: CircuitComponent): string {
  const v = c.value;
  if (!v) return c.id;
  if (c.type === 'resistor') { const n = parseValue(v); return n ? `${c.id} (${formatValue(n, 'Ω')})` : c.id; }
  return c.id;
}

/** Walks outward from a pin, stopping at devices, to find what is in series. */
function seriesPath(ctx: Ctx, fromPin: string, visited = new Set<string>()): CircuitComponent[] {
  const net = ctx.netOf.get(fromPin);
  if (!net || visited.has(net)) return [];
  visited.add(net);
  const out: CircuitComponent[] = [];
  const pins = ctx.graph.nets.find((n) => n.id === net)?.pins ?? [];
  const others = pins.filter((p) => p !== fromPin);
  for (const p of others) {
    const c = ctx.byId.get(p.split('.')[0]);
    if (!c) continue;
    out.push(c);
    // Only continue through a two-terminal pass-through when the net is a simple
    // chain; a branch point means the series assumption no longer holds.
    if (others.length === 1 && (c.type === 'switch' || c.type === 'junction' || c.type === 'inductor')) {
      const far = c.pins.find((pp) => `${c.id}.${pp}` !== p);
      if (far) out.push(...seriesPath(ctx, `${c.id}.${far}`, visited));
    }
  }
  return out;
}

/** Any resistance in series with this LED, on either side, before the supply. */
function hasSeriesResistance(ctx: Ctx, led: CircuitComponent): boolean {
  for (const pin of ['anode', 'cathode']) {
    const chain = seriesPath(ctx, `${led.id}.${pin}`);
    if (chain.some((c) => c.type === 'resistor' || c.type === 'potentiometer')) return true;
  }
  return false;
}

export function runRules(graph: CircuitGraph, sim: Simulation, floating: string[] = []): Finding[] {
  const byId = new Map(graph.components.map((c) => [c.id, c]));
  const netOf = new Map<string, string>();
  for (const n of graph.nets) for (const p of n.pins) netOf.set(p, n.id);
  const neighbours = new Map<string, Set<string>>();
  for (const n of graph.nets) {
    const ids = [...new Set(n.pins.map((p) => p.split('.')[0]))];
    for (const a of ids) {
      const set = neighbours.get(a) ?? new Set<string>();
      for (const b of ids) if (b !== a) set.add(b);
      neighbours.set(a, set);
    }
  }
  const ctx: Ctx = { graph, sim, floating, byId, netOf, neighbours };

  const findings: Finding[] = [];
  let seq = 0;
  const add = (f: Omit<Finding, 'id'>) => { findings.push({ id: `f${++seq}`, ...f }); };
  const res = (id: string) => ctx.sim.component_results[id];
  const solved = sim.status === 'ok';

  const supplyV = Math.max(
    ...graph.components.filter((c) => c.type === 'battery').map((c) => defaultValue(c) ?? 0),
    0,
  );

  // ── Rule 1: LED with no current limiting ─────────────────────────────────────
  for (const led of graph.components.filter((c) => c.type === 'led')) {
    if (hasSeriesResistance(ctx, led)) continue;
    const inCircuit = (neighbours.get(led.id)?.size ?? 0) >= 1;
    if (!inCircuit) continue;
    const r = res(led.id);
    const measured = r && solved ? Math.abs(r.current_a) : null;
    const vf = LED_VF[(led.value ?? 'red').toLowerCase()] ?? 2.0;
    // Without a resistor the only limit is the supply's internal resistance.
    const estimate = measured && measured > 0.001 ? measured : Math.max((supplyV - vf) / 0.05, 0);
    if (estimate < LED_MAX_MA / 1000 * 1.2) continue;
    const times = Math.round(estimate / (LED_MAX_MA / 1000));
    const suggested = supplyV > vf ? nearestStandard((supplyV - vf) / 0.018) : 330;
    add({
      severity: 'error',
      component_id: led.id,
      rule: 'led_no_current_limit',
      message: `${led.id} has no current-limiting resistor. At ${supplyV ? `${supplyV}V` : 'this supply voltage'} it will draw roughly ${fmtA(estimate)} — about ${times}× its ${LED_MAX_MA}mA rating — and fail within seconds.`,
      fix: `Add a ${formatValue(suggested, 'Ω')} resistor in series with ${led.id}.`,
    });
  }

  // ── Rule 2: electrolytic capacitor reverse-polarised ────────────────────────
  if (solved) {
    for (const c of graph.components.filter((x) => x.type === 'capacitor_electrolytic')) {
      const r = res(c.id);
      if (!r || r.voltage_v >= -0.2) continue;
      add({
        severity: 'error',
        component_id: c.id,
        rule: 'electrolytic_reversed',
        message: `${c.id} is connected backwards — its positive lead sits ${fmtV(Math.abs(r.voltage_v))} below its negative lead. Electrolytic capacitors vent or rupture when reverse-biased.`,
        fix: `Flip ${c.id} so the striped (negative) side faces ground.`,
      });
    }
  }

  // ── Rule 3: short circuit across the supply ────────────────────────────────
  for (const b of graph.components.filter((c) => c.type === 'battery')) {
    const pinsPos = netOf.get(`${b.id}.pos`);
    const pinsNeg = netOf.get(`${b.id}.neg`);
    const sameNet = pinsPos != null && pinsPos === pinsNeg;
    const r = res(b.id);
    const overCurrent = solved && r != null && Math.abs(r.current_a) > BATTERY_MAX_A;
    if (!sameNet && !overCurrent) continue;
    const detail = sameNet
      ? `${b.id}'s two terminals are connected together with no component between them. This is a dead short.`
      : `${b.id} is delivering ${fmtA(Math.abs(r!.current_a))} — far more than a small cell can supply. Something is shorting across it.`;
    add({
      severity: 'error',
      component_id: b.id,
      rule: 'supply_short',
      message: `${detail} The battery will overheat, and it can vent or catch fire.`,
      fix: 'Put a load — a resistor, or a resistor and an LED — in the path between the two terminals.',
    });
  }

  // ── Rule 4: floating / unconnected pin ─────────────────────────────────────
  const floatingByComp = new Map<string, string[]>();
  for (const ref of floating) {
    const [id, pin] = ref.split('.');
    floatingByComp.set(id, [...(floatingByComp.get(id) ?? []), pin]);
  }
  // A net with a single pin is just as floating as a pin with no net.
  for (const n of graph.nets) {
    if (n.pins.length !== 1) continue;
    const [id, pin] = n.pins[0].split('.');
    const list = floatingByComp.get(id) ?? [];
    if (!list.includes(pin)) floatingByComp.set(id, [...list, pin]);
  }
  for (const [id, pins] of floatingByComp) {
    const c = byId.get(id);
    if (!c) continue;
    const names = pins.map((p) => `"${p}"`).join(' and ');
    const plural = pins.length > 1;
    add({
      severity: 'warning',
      component_id: id,
      rule: 'floating_pin',
      message: `${c.id}'s ${plural ? 'leads' : 'lead'} ${names} ${plural ? 'connect' : 'connects'} to nothing, so no current flows through ${plural ? 'it at all' : 'that branch'}.`,
      fix: `Draw a wire from ${c.id}'s ${names} lead${plural ? 's' : ''} to the rest of the circuit, or remove ${c.id}.`,
    });
  }

  // ── Rule 5: resistor power rating exceeded ─────────────────────────────────
  if (solved) {
    for (const c of graph.components.filter((x) => x.type === 'resistor')) {
      const r = res(c.id);
      if (!r || r.power_w <= RESISTOR_RATING_W * 0.8) continue;
      const over = r.power_w > RESISTOR_RATING_W;
      const bigger = r.power_w > 1 ? '2W' : r.power_w > 0.5 ? '1W' : '0.5W';
      const rv = defaultValue(c) ?? 0;
      add({
        severity: over ? 'error' : 'warning',
        component_id: c.id,
        rule: 'power_rating_exceeded',
        message: over
          ? `${label(c)} dissipates ${fmtW(r.power_w)}, but a standard through-hole resistor is rated ${RESISTOR_RATING_W}W. It will run hot, drift in value, and can scorch the board.`
          : `${label(c)} dissipates ${fmtW(r.power_w)}, which is close to the ${RESISTOR_RATING_W}W rating of a standard through-hole resistor. It will get noticeably warm.`,
        fix: `Use a ${bigger} resistor, or raise the resistance to ${formatValue(nearestStandard(rv * (r.power_w / (RESISTOR_RATING_W * 0.4))), 'Ω')} to cut the current.`,
      });
    }
  }

  // ── Extended checks ────────────────────────────────────────────────────────

  // LED fitted backwards: forward-biased path exists but it is reverse-connected.
  if (solved) {
    for (const led of graph.components.filter((c) => c.type === 'led')) {
      const r = res(led.id);
      if (!r || r.voltage_v > -0.5) continue;
      if ((neighbours.get(led.id)?.size ?? 0) < 1) continue;
      add({
        severity: 'error',
        component_id: led.id,
        rule: 'led_reversed',
        message: `${led.id} is in backwards — it has ${fmtV(Math.abs(r.voltage_v))} across it the wrong way, so it blocks current and stays dark.`,
        fix: `Turn ${led.id} around. Its longer lead (the anode) goes toward the positive side of the supply.`,
      });
    }
  }

  // Inductive load with no flyback diode.
  for (const c of graph.components.filter((x) => ['motor', 'buzzer', 'inductor'].includes(x.type))) {
    const nbr = [...(neighbours.get(c.id) ?? [])].map((id) => byId.get(id)!).filter(Boolean);
    if (nbr.some((n) => n.type === 'diode')) continue;
    if (nbr.length === 0) continue;
    add({
      severity: 'warning',
      component_id: c.id,
      rule: 'no_flyback_diode',
      message: `${c.id} is an inductive load with no flyback diode across it. When the current is interrupted the collapsing field produces a voltage spike that can destroy whatever is switching it.`,
      fix: `Put a diode across ${c.id}, cathode to the positive side, so the spike has somewhere to go.`,
    });
  }

  // Transistor base with no resistor.
  for (const q of graph.components.filter((c) => c.type === 'transistor')) {
    const baseNet = netOf.get(`${q.id}.base`);
    if (!baseNet) continue;
    const onBase = (graph.nets.find((n) => n.id === baseNet)?.pins ?? [])
      .map((p) => byId.get(p.split('.')[0])!).filter(Boolean);
    if (onBase.some((c) => c.type === 'resistor' || c.type === 'potentiometer')) continue;
    add({
      severity: 'warning',
      component_id: q.id,
      rule: 'transistor_base_no_resistor',
      message: `${q.id}'s base connects straight to the drive signal with no resistor. The base-emitter junction looks like a diode, so it will pull as much current as the source can give and take the transistor or the driver with it.`,
      fix: `Add a resistor in series with ${q.id}'s base — 1kΩ is a safe starting point for small-signal switching.`,
    });
  }

  // Supply voltage above an LED's reverse rating, or an obviously wrong supply.
  if (supplyV > 24) {
    const b = graph.components.find((c) => c.type === 'battery');
    add({
      severity: 'warning',
      component_id: b?.id ?? null,
      rule: 'supply_voltage_high',
      message: `The supply reads ${supplyV}V. That is above what most breadboard parts and small LEDs tolerate, and it is also a common mis-read of a handwritten value.`,
      fix: 'Check the voltage written on the sketch, and correct it in the inspector if it is wrong.',
    });
  }

  // Values the vision stage could not read, so the solver assumed one.
  const assumed = graph.components.filter((c) => valueAssumed(c) && defaultValue(c) != null && !c.user_edited);
  for (const c of assumed) {
    const d = defaultValue(c)!;
    const unit = c.type === 'battery' ? 'V' : c.type === 'resistor' || c.type === 'potentiometer' ? 'Ω' : c.type.startsWith('capacitor') ? 'F' : '';
    add({
      severity: 'info',
      component_id: c.id,
      rule: 'value_assumed',
      message: `No value could be read for ${c.id}, so the analysis assumed ${formatValue(d, unit)}.`,
      fix: `Click ${c.id} and type the value written on your sketch — the findings update straight away.`,
    });
  }

  // Devices outside the DC model, stated plainly rather than silently ignored.
  for (const c of graph.components.filter((x) => x.type === 'transistor' || x.type === 'ic')) {
    add({
      severity: 'info',
      component_id: c.id,
      rule: 'not_simulated',
      message: `${c.id} is drawn and shown, but its internal behaviour is not part of the DC analysis, so currents around it are not computed.`,
      fix: 'Treat the surrounding readings as approximate, and check this part by hand.',
    });
  }

  if (sim.status !== 'ok' && sim.reason) {
    add({
      severity: sim.status === 'no_source' ? 'warning' : 'error',
      component_id: null,
      rule: `unsimulatable_${sim.status}`,
      message: sim.reason,
      fix: sim.status === 'no_source'
        ? 'Add a battery or supply to the sketch, or add one from the inspector.'
        : 'Check the connections flagged below, then re-run the analysis.',
    });
  }

  const order = { error: 0, warning: 1, info: 2 };
  return findings.sort((a, b) => order[a.severity] - order[b.severity]);
}
