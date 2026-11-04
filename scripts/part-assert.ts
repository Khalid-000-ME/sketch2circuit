/**
 * Hand-checked tests of the device primitives behind described parts.
 *
 * Each expected value was worked out on paper from the device equations, not read
 * back from the solver. A part is built from JSON the way a generated one is, so
 * validation is exercised too, and measured through the same bench the checks use.
 *
 * Run: npx tsx scripts/part-assert.ts
 */
import { validatePart, type PartDef } from '../src/lib/circuit/partdef';
import { runCheck } from '../src/lib/circuit/part-checks';

const base = { prefix: 'U', summary: 's', fidelity: 'full', body: { colour: '#333333', mark: '', tall: false } };
const mk = (o: object): PartDef => {
  const r = validatePart({ ...base, ...o });
  if (!r.ok) throw new Error(`invalid part: ${r.errors.join('; ')}`);
  return r.def!;
};

let failed = 0;
const t = (name: string, def: PartDef, check: Parameters<typeof runCheck>[1]) => {
  const r = runCheck(def, check);
  if (!r.pass) failed++;
  console.log(`${r.pass ? 'ok  ' : 'FAIL'} ${name}${r.pass ? '' : '\n     ' + r.detail.join('\n     ')}`);
};
const src = (pos: string, neg: string, volts: number, rint = 0) => ({ kind: 'vsource' as const, pos, neg, volts, rint });

// 1. Divider: 1k over 2k from 9V, mid = 6.000V, current 3mA.
const divider = mk({ name: 'Divider', pins: [{ name: 'top', side: 'left' }, { name: 'mid', side: 'right' }, { name: 'bot', side: 'left' }],
  elements: [{ kind: 'resistor', a: 'top', b: 'mid', ohms: 1000 }, { kind: 'resistor', a: 'mid', b: 'bot', ohms: 2000 }] });
t('divider midpoint and current', divider, { say: '', drive: [src('top', 'bot', 9)],
  expect: [{ kind: 'voltage', a: 'mid', b: 'bot', min: 5.999, max: 6.001 }, { kind: 'current', pin: 'top', min: 0.002999, max: 0.003001 }] });

// 2. Editable value: a resistor whose ohms is the part's value. 12V over 470 = 25.532mA.
const vr = mk({ name: 'R', pins: [{ name: 'a', side: 'left' }, { name: 'b', side: 'right' }], param: { label: 'R', unit: 'ohm', default: 1000 },
  elements: [{ kind: 'resistor', a: 'a', b: 'b', ohms: 'value' }] });
t('uses its value', vr, { say: '', value: 470, drive: [src('a', 'b', 12)], expect: [{ kind: 'current', pin: 'a', min: 0.02553, max: 0.02554 }] });
t('uses its default', vr, { say: '', drive: [src('a', 'b', 12)], expect: [{ kind: 'current', pin: 'a', min: 0.0119999, max: 0.0120001 }] });

// 3. Zener 5.1V behind 330 ohm from 9V. Hand: Vz node = 5.1 + 0.05 ln(I/5mA) + 2*I, I = 11.62mA.
const zener = mk({ name: 'Zener 5V1', prefix: 'D', pins: [{ name: 'a', side: 'left' }, { name: 'k', side: 'right' }],
  elements: [{ kind: 'zener', a: 'a', k: 'k', vz: 5.1, rs: 2 }] });
t('zener holds 5.1V in reverse', zener, { say: '', drive: [src('k', 'a', 9, 330)],
  expect: [{ kind: 'voltage', a: 'k', b: 'a', min: 5.14, max: 5.19 }, { kind: 'current', pin: 'k', min: 0.01155, max: 0.01170 }] });
t('zener conducts forward at 0.7V', zener, { say: '', drive: [src('a', 'k', 9, 330)],
  expect: [{ kind: 'voltage', a: 'a', b: 'k', min: 0.70, max: 0.73 }, { kind: 'current', pin: 'a', min: 0.0249, max: 0.0253 }] });
t('zener blocks below breakdown', zener, { say: '', drive: [src('k', 'a', 3, 330)],
  expect: [{ kind: 'current', pin: 'k', min: -1e-6, max: 1e-6 }] });

// 4. NPN. Active: Ib=(5-0.6925)/100k=43.07uA, Ic=100*Ib=4.307mA, Vce=12-4.307=7.69V.
const npn = mk({ name: 'NPN', prefix: 'Q', pins: [{ name: 'c', side: 'top' }, { name: 'b', side: 'left' }, { name: 'e', side: 'bottom' }],
  elements: [{ kind: 'bjt', c: 'c', b: 'b', e: 'e', polarity: 'npn', beta: 100 }] });
t('npn amplifies by beta', npn, { say: '', drive: [src('b', 'e', 5, 100e3), src('c', 'e', 12, 1000)],
  expect: [{ kind: 'current', pin: 'c', min: 0.00425, max: 0.00435 }, { kind: 'voltage', a: 'c', b: 'e', min: 7.6, max: 7.8 }] });
t('npn saturates as a switch', npn, { say: '', drive: [src('b', 'e', 5, 10e3), src('c', 'e', 5, 1000)],
  expect: [{ kind: 'voltage', a: 'c', b: 'e', min: 0.0, max: 0.2 }, { kind: 'current', pin: 'c', min: 0.0048, max: 0.0050 }] });
t('npn is off with no base drive', npn, { say: '', drive: [src('b', 'e', 0, 10e3), src('c', 'e', 5, 1000)],
  expect: [{ kind: 'current', pin: 'c', min: -1e-6, max: 1e-6 }] });
// PNP mirrors it: emitter at +12, collector load to ground.
const pnp = mk({ name: 'PNP', prefix: 'Q', pins: [{ name: 'c', side: 'top' }, { name: 'b', side: 'left' }, { name: 'e', side: 'bottom' }],
  elements: [{ kind: 'bjt', c: 'c', b: 'b', e: 'e', polarity: 'pnp', beta: 100 }] });
t('pnp amplifies by beta (mirror)', pnp, { say: '', drive: [src('e', 'b', 5, 100e3), src('e', 'c', 12, 1000)],
  expect: [{ kind: 'current', pin: 'e', min: 0.00425 + 0.0000425, max: 0.00435 + 0.0000435 }] });

// 5. N-MOSFET, vth 2, k 0.5. Triode: 25 Vds^2 - 151 Vds + 10 = 0 -> Vds = 0.06696, Id = 99.33mA.
const nmos = mk({ name: 'NMOS', prefix: 'Q', pins: [{ name: 'd', side: 'top' }, { name: 'g', side: 'left' }, { name: 's', side: 'bottom' }],
  elements: [{ kind: 'mosfet', d: 'd', g: 'g', s: 's', polarity: 'n', vth: 2, k: 0.5 }] });
t('nmos in the triode region', nmos, { say: '', drive: [src('g', 's', 5), src('d', 's', 10, 100)],
  expect: [{ kind: 'voltage', a: 'd', b: 's', min: 0.0660, max: 0.0680 }, { kind: 'current', pin: 'd', min: 0.0990, max: 0.0996 }] });
t('nmos in saturation: Id = k/2 (Vgs-Vth)^2 = 2.25A', nmos, { say: '', drive: [src('g', 's', 5), src('d', 's', 10, 1)],
  expect: [{ kind: 'current', pin: 'd', min: 2.2499, max: 2.2501 }, { kind: 'voltage', a: 'd', b: 's', min: 7.74, max: 7.76 }] });
t('nmos is off below threshold', nmos, { say: '', drive: [src('g', 's', 1), src('d', 's', 10, 100)],
  expect: [{ kind: 'current', pin: 'd', min: -1e-6, max: 1e-6 }] });

// 6. Relay: coil 400 ohm, pulls in at 3.75V. 5V coil: 12.5mA; contact then carries 12V/100.01 = 0.11999A.
const relay = mk({ name: 'Relay', prefix: 'K', pins: [{ name: 'cp', side: 'left' }, { name: 'cn', side: 'left' }, { name: 'com', side: 'right' }, { name: 'no', side: 'right' }],
  elements: [{ kind: 'resistor', a: 'cp', b: 'cn', ohms: 400 }, { kind: 'vswitch', a: 'com', b: 'no', cp: 'cp', cn: 'cn', threshold: 3.75, closed_above: true }] });
t('relay: coil current', relay, { say: '', drive: [src('cp', 'cn', 5), src('com', 'no', 12, 100)], expect: [{ kind: 'current', pin: 'cp', min: 0.01249, max: 0.01251 }] });
t('relay: contact closes at 5V', relay, { say: '', drive: [src('cp', 'cn', 5), src('com', 'no', 12, 100)], expect: [{ kind: 'current', pin: 'com', min: 0.1199, max: 0.1201 }] });
t('relay: contact stays open at 3V', relay, { say: '', drive: [src('cp', 'cn', 3), src('com', 'no', 12, 100)], expect: [{ kind: 'current', pin: 'com', min: -1e-6, max: 1e-6 }] });

// 7. Op-amp on 12V/0V: follower tracks, clips at V+ - 1.5, comparator swings rail to rail.
const opamp = mk({ name: 'OpAmp', prefix: 'U', pins: [{ name: 'ip', side: 'left' }, { name: 'im', side: 'left' }, { name: 'out', side: 'right' }, { name: 'vcc', side: 'top' }, { name: 'vee', side: 'bottom' }],
  elements: [{ kind: 'opamp', inp: 'ip', inn: 'im', out: 'out', vcc: 'vcc', vee: 'vee' }] });
const wire = { kind: 'resistor' as const, a: 'out', b: 'im', ohms: 0.001 };
t('op-amp follower tracks 2V', opamp, { say: '', drive: [src('vcc', 'vee', 12), src('ip', 'vee', 2), wire],
  expect: [{ kind: 'voltage', a: 'out', b: 'vee', min: 1.999, max: 2.001 }] });
t('op-amp follower clips near the rail', opamp, { say: '', drive: [src('vcc', 'vee', 12), src('ip', 'vee', 11.5), wire],
  expect: [{ kind: 'voltage', a: 'out', b: 'vee', min: 10.3, max: 10.55 }] });
t('op-amp as comparator, high', opamp, { say: '', drive: [src('vcc', 'vee', 12), src('ip', 'vee', 3), src('im', 'vee', 2)],
  expect: [{ kind: 'voltage', a: 'out', b: 'vee', min: 10.3, max: 10.55 }] });
t('op-amp as comparator, low', opamp, { say: '', drive: [src('vcc', 'vee', 12), src('ip', 'vee', 1), src('im', 'vee', 2)],
  expect: [{ kind: 'voltage', a: 'out', b: 'vee', min: 0.0, max: 0.2 }] });

// 8. Current source into a load: 10mA through 1k reads 10V.
const cs = mk({ name: 'Isrc', pins: [{ name: 'a', side: 'left' }, { name: 'b', side: 'right' }], elements: [{ kind: 'isource', from: 'a', to: 'b', amps: 0.01 }] });
t('current source into 1k', cs, { say: '', drive: [{ kind: 'resistor', a: 'b', b: 'a', ohms: 1000 }, { kind: 'ground', pin: 'a' }],
  expect: [{ kind: 'voltage', a: 'b', b: 'a', min: 9.999, max: 10.001 }] });

// Validation rejects what cannot be solved.
const bad = validatePart({ ...base, name: 'Bad', pins: [{ name: 'a', side: 'left' }], elements: [{ kind: 'resistor', a: 'a', b: 'ghost', ohms: 10 }] });
if (bad.ok) { failed++; console.log('FAIL validation accepted an unknown node'); } else console.log('ok   validation rejects an unknown node');
const nan = validatePart({ ...base, name: 'Bad', pins: [{ name: 'a', side: 'left' }, { name: 'b', side: 'left' }], elements: [{ kind: 'resistor', a: 'a', b: 'b', ohms: 0 }] });
if (nan.ok) { failed++; console.log('FAIL validation accepted 0 ohms'); } else console.log('ok   validation rejects 0 ohms');

// The parts that ship with the app are held to their own checks.
import { STARTER_PARTS } from '../src/fixtures/parts';
import { runChecks } from '../src/lib/circuit/part-checks';
for (const def of STARTER_PARTS) {
  const results = runChecks(def);
  const bad = results.filter((r) => !r.pass);
  if (bad.length || results.length < 2) failed++;
  console.log(`${bad.length || results.length < 2 ? 'FAIL' : 'ok  '} starter part: ${def.name} (${results.length} checks)${bad.map((r) => `\n     ${r.say}\n       ${r.detail.join('\n       ')}`).join('')}`);
}

// Described parts inside whole circuits, against values worked out by hand.
import { ALL_FIXTURES } from '../src/fixtures/circuits';
import { analyseGraph } from '../src/lib/pipeline/analyse';
function circuit(name: string, key: keyof typeof ALL_FIXTURES, expect: (a: ReturnType<typeof analyseGraph>) => string[]) {
  const a = analyseGraph(ALL_FIXTURES[key]);
  const problems = a.simulation.status === 'ok' ? expect(a) : [`did not solve: ${a.simulation.reason}`];
  if (problems.length) failed++;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} circuit: ${name}${problems.map((p) => `\n     ${p}`).join('')}`);
}
const within = (label: string, got: number, lo: number, hi: number) => (got >= lo && got <= hi ? [] : [`${label} = ${got.toPrecision(5)}, expected ${lo} to ${hi}`]);
const mA = (a: ReturnType<typeof analyseGraph>, id: string) => (a.simulation.component_results[id]?.current_a ?? NaN) * 1e3;
const rules = (a: ReturnType<typeof analyseGraph>) => a.findings.map((f) => f.rule).sort().join(',');
// By hand: Vb = 9.01 / (1 + 1.7/126 + 1.7/470) = 8.865 V, coil = 8.865/126 = 70.36 mA = 4.925 V, LED 14.7 mA.
circuit('relay pulls in and lights the LED', 'RELAY_LED', (a) => [
  ...within('coil current mA', mA(a, 'K1'), 69.8, 70.8),
  ...within('coil volts', a.simulation.component_results.K1.voltage_v, 4.88, 4.96),
  ...within('LED mA', mA(a, 'D1'), 14.4, 15.4),
  ...(rules(a) === 'part_model_limits,power_rating_exceeded' ? [] : [`rules were ${rules(a)}`]),
]);
// By hand: the coil sees about 2.1 V, below the 3.75 V pull-in, so the contact stays open.
circuit('relay stays open when starved', 'RELAY_STARVED', (a) => [
  ...within('LED mA', mA(a, 'D1'), -0.001, 0.001),
  ...within('coil volts', a.simulation.component_results.K1.voltage_v, 1.9, 3.7),
]);
// By hand, iterating Vz-node = 5.1 + 0.05 ln(Iz/5mA) + 2 Iz with 331.7 ohm and a 1k load: 5.127 V, Iz 6.55 mA.
circuit('zener regulates a loaded supply', 'ZENER_REGULATOR', (a) => [
  ...within('output volts', a.simulation.node_voltages[a.nets.find((n) => n.pins.includes('R2.a'))!.id], 5.10, 5.16),
  ...within('zener mA', mA(a, 'D1'), 6.4, 6.7),
]);
// By hand (Ebers-Moll): Ic = 15.4 mA, Ib = 4.1 mA saturates it: Vbe 0.74 V, Vce 0.033 V.
circuit('arduino pin saturates an npn', 'ARDUINO_NPN_LED', (a) => {
  const v = (pin: string) => a.simulation.node_voltages[a.nets.find((n) => n.pins.includes(pin))!.id];
  return [
    ...within('LED mA', mA(a, 'D1'), 15.0, 15.8),
    ...within('Vce', v('Q1.c') - v('Q1.e'), 0.02, 0.05),
    ...within('Vbe', v('Q1.b') - v('Q1.e'), 0.72, 0.76),
  ];
});

console.log(failed ? `\n${failed} failed` : '\nall passed');
process.exit(failed ? 1 : 0);
