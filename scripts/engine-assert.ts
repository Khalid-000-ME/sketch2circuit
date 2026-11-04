/**
 * Asserted checks on the solver and the rule suite.
 *
 * engine-test.ts prints; this fails. Every number below was worked out by hand
 * from the component models, independently of the solver, before the solver was
 * compared against it. A change that moves one of them is a change in what the
 * product tells a person, and should be made on purpose.
 *
 * Run: npx tsx scripts/engine-assert.ts
 */
import { ALL_FIXTURES } from '../src/fixtures/circuits';
import { canonicalise } from '../src/lib/circuit/graph';
import { runRules } from '../src/lib/circuit/rules';
import { solveDC } from '../src/lib/circuit/solve';

const cases: Array<{
  name: keyof typeof ALL_FIXTURES;
  /** The non-info rules that must fire, and no others. */
  rules: string[];
  /** Currents in mA with a relative tolerance, by "component" or "pin". */
  currents?: Record<string, [mA: number, tol: number]>;
}> = [
  // 330 ohms dissipates 0.154 W, under the warning threshold. The 220 ohm sample is the one that warns.
  { name: 'SERIES_OK', rules: [] },
  { name: 'LED_NO_RESISTOR', rules: ['led_no_current_limit'], currents: { D1: [438, 0.02] } },
  { name: 'RESISTOR_OVER_POWER', rules: ['power_rating_exceeded'] },
  { name: 'PARALLEL_SWITCH', rules: [] },
  { name: 'ELECTROLYTIC_REVERSED', rules: ['electrolytic_reversed'] },
  { name: 'SUPPLY_SHORT', rules: ['supply_short', 'floating_pin'] },
  { name: 'FLOATING_BRANCH', rules: ['floating_pin'] },
  { name: 'MOTOR_DRIVER', rules: ['no_flyback_diode', 'transistor_base_no_resistor'] },
  // Boards. Currents are the hand-solved series loops, red LED at 1.8V, green at 2.2V.
  { name: 'ARDUINO_BLINK_OK', rules: [], currents: { 'U1.D13': [12.83, 0.02] } },
  { name: 'ARDUINO_LED_DIRECT', rules: ['led_no_current_limit', 'gpio_overcurrent'], currents: { 'U1.D13': [62.4, 0.02] } },
  { name: 'PI_LED_DIRECT', rules: ['led_no_current_limit', 'gpio_overcurrent'], currents: { 'RPI1.GPIO17': [27.4, 0.02] } },
  { name: 'PI_LED_OK', rules: [], currents: { 'RPI1.GPIO17': [3.8, 0.03] } },
  { name: 'ARDUINO_TO_PI_5V', rules: ['gpio_voltage_exceeded'] },
];

let failures = 0;
const fail = (msg: string) => { failures++; console.log(`  FAIL  ${msg}`); };

for (const t of cases) {
  const canon = canonicalise(ALL_FIXTURES[t.name]);
  const sim = solveDC(canon);
  const findings = runRules(canon, sim, canon.floating);
  const got = [...new Set(findings.filter((f) => f.severity !== 'info').map((f) => f.rule))].sort();
  const want = [...t.rules].sort();
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${t.name.padEnd(22)} rules: ${got.join(', ') || '(none)'}`);
  if (!ok) fail(`${t.name}: expected [${want}] got [${got}]`);

  for (const [key, [mA, tol]] of Object.entries(t.currents ?? {})) {
    const amps = key.includes('.') ? sim.pin_currents?.[key] : sim.component_results[key]?.current_a;
    const gotMa = Math.abs((amps ?? NaN) * 1000);
    const near = Math.abs(gotMa - mA) <= mA * tol;
    console.log(`        ${key.padEnd(14)} ${gotMa.toFixed(2)} mA  (hand: ${mA} mA ±${tol * 100}%)  ${near ? 'ok' : 'FAIL'}`);
    if (!near) fail(`${t.name} ${key}: ${gotMa.toFixed(2)} vs ${mA}`);
  }
}

// Strict board pins: an unknown pin is dropped and reported, never remapped.
const bad = canonicalise({
  components: [{ id: 'U1', type: 'arduino_uno', value: null, unit: null, orientation: null, bbox: null, mask_id: null, confidence: 1, pins: [] } as never,
    { id: 'R1', type: 'resistor', value: '220', unit: null, orientation: null, bbox: null, mask_id: null, confidence: 1, pins: [] } as never],
  nets: [{ id: 'N1', pins: ['U1.D99', 'R1.a'] }],
});
const dropped = bad.warnings.some((w) => w.includes('no pin called "D99"'));
const remapped = bad.nets.some((n) => n.pins.some((p) => p.startsWith('U1.')));
console.log(`${dropped && !remapped ? 'ok  ' : 'FAIL'}  unknown board pin is dropped and reported, not remapped`);
if (!dropped || remapped) fail('unknown board pin handling');

console.log(failures ? `\n${failures} failure(s)` : '\nall assertions hold');
process.exit(failures ? 1 : 0);
