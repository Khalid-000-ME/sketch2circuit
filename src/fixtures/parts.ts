/**
 * Parts that ship with the app, written as described parts.
 *
 * They are the same kind of thing a person gets from "describe a part", and are
 * held to the same standard: every one carries bench checks, and
 * scripts/part-assert.ts fails if any of them does not pass on the solver. The
 * expected numbers were worked out by hand from the device equations.
 */

import { validatePart, type PartDef } from '../lib/circuit/partdef';

const vs = (pos: string, neg: string, volts: number, rint = 0) => ({ kind: 'vsource', pos, neg, volts, rint });
const body = (colour: string, mark: string, tall = false) => ({ colour, mark, tall });
const Q_PINS = [{ name: 'c', side: 'top', label: 'C' }, { name: 'b', side: 'left', label: 'B' }, { name: 'e', side: 'bottom', label: 'E' }];
const D_PINS = [{ name: 'a', side: 'left', label: 'A' }, { name: 'k', side: 'right', label: 'K' }];

const RAW: object[] = [
  {
    name: '5V relay', prefix: 'K', summary: 'Coil of 70 ohm, pulls in at 3.75 V. One normally open contact, 10 A.',
    pins: [{ name: 'coil_p', side: 'left', label: 'COIL+' }, { name: 'coil_n', side: 'left', label: 'COIL-' }, { name: 'com', side: 'right', label: 'COM' }, { name: 'no', side: 'right', label: 'NO' }],
    elements: [{ kind: 'resistor', a: 'coil_p', b: 'coil_n', ohms: 70 }, { kind: 'vswitch', a: 'com', b: 'no', cp: 'coil_p', cn: 'coil_n', threshold: 3.75, closed_above: true }],
    ratings: [{ kind: 'voltage', a: 'coil_p', b: 'coil_n', max: 7.5, label: 'coil rated 5 V' }, { kind: 'current', pin: 'com', max: 10, label: 'contact rated 10 A' }],
    body: body('#1565c0', 'K', true), fidelity: 'dc_only', assumptions: ['Pull-in at 75% of rated voltage.'],
    limits: ['Contact bounce and switching time are not modelled.'],
    checks: [
      { say: '5 V on the coil draws about 71 mA', drive: [vs('coil_p', 'coil_n', 5)], expect: [{ kind: 'current', pin: 'coil_p', min: 0.0705, max: 0.0723 }] },
      { say: 'The contact closes with 5 V on the coil', drive: [vs('coil_p', 'coil_n', 5), vs('com', 'no', 12, 100)], expect: [{ kind: 'current', pin: 'com', min: 0.1199, max: 0.1201 }] },
      { say: 'The contact stays open with 2 V on the coil', drive: [vs('coil_p', 'coil_n', 2), vs('com', 'no', 12, 100)], expect: [{ kind: 'current', pin: 'com', min: -1e-6, max: 1e-6 }] },
    ],
  },
  {
    name: 'Zener 5.1V', prefix: 'D', summary: '1N4733A-like. Holds 5.1 V in reverse, 1 W.',
    pins: D_PINS, elements: [{ kind: 'zener', a: 'a', k: 'k', vz: 5.1, rs: 2 }],
    ratings: [{ kind: 'power', max: 1, label: '1 W dissipation' }],
    body: body('#b0b7bf', 'Z5V1'), fidelity: 'full', assumptions: ['5.1 V is reached at 5 mA.'], limits: [],
    checks: [
      { say: 'Holds about 5.1 V in reverse behind 330 ohm from 9 V', drive: [vs('k', 'a', 9, 330)], expect: [{ kind: 'voltage', a: 'k', b: 'a', min: 5.14, max: 5.19 }, { kind: 'current', pin: 'k', min: 0.01155, max: 0.0117 }] },
      { say: 'Conducts forward at about 0.7 V', drive: [vs('a', 'k', 9, 330)], expect: [{ kind: 'voltage', a: 'a', b: 'k', min: 0.7, max: 0.73 }] },
      { say: 'Blocks below breakdown', drive: [vs('k', 'a', 3, 330)], expect: [{ kind: 'current', pin: 'k', min: -1e-6, max: 1e-6 }] },
    ],
  },
  {
    name: 'NPN transistor', prefix: 'Q', summary: '2N2222-like, current gain 100, 40 V, 0.8 A.',
    pins: Q_PINS, elements: [{ kind: 'bjt', c: 'c', b: 'b', e: 'e', polarity: 'npn', beta: 100 }],
    ratings: [{ kind: 'voltage', a: 'c', b: 'e', max: 40, label: 'collector-emitter 40 V' }, { kind: 'current', pin: 'c', max: 0.8, label: 'collector current 0.8 A' }],
    body: body('#26292e', '2N2222'), fidelity: 'full', assumptions: ['Current gain 100 in the active region.'], limits: ['Early effect and temperature are not modelled.'],
    checks: [
      { say: 'Amplifies base current by about 100', drive: [vs('b', 'e', 5, 100e3), vs('c', 'e', 12, 1000)], expect: [{ kind: 'current', pin: 'c', min: 0.00425, max: 0.00435 }, { kind: 'voltage', a: 'c', b: 'e', min: 7.6, max: 7.8 }] },
      { say: 'Saturates as a switch', drive: [vs('b', 'e', 5, 10e3), vs('c', 'e', 5, 1000)], expect: [{ kind: 'voltage', a: 'c', b: 'e', min: 0, max: 0.2 }] },
      { say: 'Is off with no base drive', drive: [vs('b', 'e', 0, 10e3), vs('c', 'e', 5, 1000)], expect: [{ kind: 'current', pin: 'c', min: -1e-6, max: 1e-6 }] },
    ],
  },
  {
    name: 'PNP transistor', prefix: 'Q', summary: '2N2907-like, current gain 100, 40 V, 0.6 A.',
    pins: Q_PINS, elements: [{ kind: 'bjt', c: 'c', b: 'b', e: 'e', polarity: 'pnp', beta: 100 }],
    ratings: [{ kind: 'voltage', a: 'e', b: 'c', max: 40, label: 'emitter-collector 40 V' }, { kind: 'current', pin: 'c', max: 0.6, label: 'collector current 0.6 A' }],
    body: body('#26292e', '2N2907'), fidelity: 'full', assumptions: ['Current gain 100 in the active region.'], limits: ['Early effect and temperature are not modelled.'],
    checks: [
      { say: 'Amplifies base current by about 100, emitter at the supply', drive: [vs('e', 'b', 5, 100e3), vs('e', 'c', 12, 1000)], expect: [{ kind: 'current', pin: 'e', min: 0.00429, max: 0.00439 }] },
      { say: 'Is off with no base drive', drive: [vs('e', 'b', 0, 10e3), vs('e', 'c', 5, 1000)], expect: [{ kind: 'current', pin: 'c', min: -1e-6, max: 1e-6 }] },
    ],
  },
  {
    name: 'N-MOSFET (logic level)', prefix: 'Q', summary: 'IRLZ44N-like: switches fully on at 5 V, about 20 milliohm, 55 V.',
    pins: [{ name: 'd', side: 'top', label: 'D' }, { name: 'g', side: 'left', label: 'G' }, { name: 's', side: 'bottom', label: 'S' }],
    elements: [{ kind: 'mosfet', d: 'd', g: 'g', s: 's', polarity: 'n', vth: 1.5, k: 15 }],
    ratings: [{ kind: 'voltage', a: 'd', b: 's', max: 55, label: 'drain-source 55 V' }, { kind: 'voltage', a: 'g', b: 's', max: 16, label: 'gate-source 16 V' }, { kind: 'current', pin: 'd', max: 47, label: 'drain current 47 A' }],
    body: body('#26292e', 'IRLZ44', true), fidelity: 'full', assumptions: ['Threshold 1.5 V, on-resistance about 19 milliohm at 5 V gate drive.'], limits: ['Gate capacitance and switching speed are not modelled.'],
    checks: [
      { say: 'Fully on at 5 V on the gate, 10 V through 10 ohm', drive: [vs('g', 's', 5), vs('d', 's', 10, 10)], expect: [{ kind: 'current', pin: 'd', min: 0.9975, max: 0.9986 }, { kind: 'voltage', a: 'd', b: 's', min: 0.018, max: 0.0200 }] },
      { say: 'Off at 0.5 V on the gate', drive: [vs('g', 's', 0.5), vs('d', 's', 10, 10)], expect: [{ kind: 'current', pin: 'd', min: -1e-6, max: 1e-6 }] },
    ],
  },
  {
    name: 'Op-amp', prefix: 'U', summary: 'LM358-like single-supply amplifier. Output swings to 1.5 V below the supply.',
    pins: [{ name: 'ip', side: 'left', label: 'IN+' }, { name: 'im', side: 'left', label: 'IN-' }, { name: 'out', side: 'right', label: 'OUT' }, { name: 'vcc', side: 'top', label: 'V+' }, { name: 'vee', side: 'bottom', label: 'V-' }],
    elements: [{ kind: 'opamp', inp: 'ip', inn: 'im', out: 'out', vcc: 'vcc', vee: 'vee' }],
    ratings: [{ kind: 'voltage', a: 'vcc', b: 'vee', max: 32, label: 'supply 32 V' }],
    body: body('#26292e', 'LM358'), fidelity: 'approximate', assumptions: ['Open-loop gain 100000, 50 ohm output resistance.', 'Output reaches V- + 0.05 V low and V+ - 1.5 V high.'],
    limits: ['Bandwidth, slew rate and input offset are not modelled.'],
    checks: [
      { say: 'Follower tracks a 2 V input', drive: [vs('vcc', 'vee', 12), vs('ip', 'vee', 2), { kind: 'resistor', a: 'out', b: 'im', ohms: 0.001 }], expect: [{ kind: 'voltage', a: 'out', b: 'vee', min: 1.999, max: 2.001 }] },
      { say: 'Output goes high when IN+ is above IN-', drive: [vs('vcc', 'vee', 12), vs('ip', 'vee', 3), vs('im', 'vee', 2)], expect: [{ kind: 'voltage', a: 'out', b: 'vee', min: 10.3, max: 10.55 }] },
      { say: 'Output goes low when IN+ is below IN-', drive: [vs('vcc', 'vee', 12), vs('ip', 'vee', 1), vs('im', 'vee', 2)], expect: [{ kind: 'voltage', a: 'out', b: 'vee', min: 0, max: 0.2 }] },
    ],
  },
  {
    name: 'Schottky diode', prefix: 'D', summary: '1N5817-like: low forward drop, small leakage.',
    pins: D_PINS, elements: [{ kind: 'diode', a: 'a', k: 'k', vf: 0.25, rs: 0.2 }],
    ratings: [{ kind: 'voltage', a: 'k', b: 'a', max: 20, label: 'reverse voltage 20 V' }, { kind: 'current', pin: 'a', max: 1, label: 'forward current 1 A' }],
    body: body('#26292e', '1N5817'), fidelity: 'full', assumptions: ['0.25 V forward at 20 mA.'], limits: ['Reverse leakage is a fixed small value, not temperature dependent.'],
    checks: [
      { say: 'Drops about 0.21 V at 4.8 mA', drive: [vs('a', 'k', 5, 1000)], expect: [{ kind: 'voltage', a: 'a', b: 'k', min: 0.205, max: 0.215 }, { kind: 'current', pin: 'a', min: 0.00477, max: 0.00481 }] },
      { say: 'Leaks almost nothing in reverse', drive: [vs('k', 'a', 5, 1000)], expect: [{ kind: 'current', pin: 'k', min: -1e-5, max: 1e-5 }] },
    ],
  },
  {
    name: 'Photoresistor (LDR)', prefix: 'R', summary: 'Resistance set by the light on it: type the resistance for the light level you want.',
    pins: [{ name: 'a', side: 'left', label: 'A' }, { name: 'b', side: 'right', label: 'B' }], param: { label: 'Resistance', unit: 'ohm', default: 10000 },
    elements: [{ kind: 'resistor', a: 'a', b: 'b', ohms: 'value' }],
    ratings: [{ kind: 'power', max: 0.1, label: '100 mW' }],
    body: body('#c8a15a', 'LDR'), fidelity: 'approximate', assumptions: ['Roughly 1 kohm in bright light, 10 kohm in room light, 1 Mohm in the dark.'], limits: ['The light level is not a quantity here: you set the resistance it would have.'],
    checks: [
      { say: 'At the default 10 kohm, 5 V gives 0.5 mA', drive: [vs('a', 'b', 5)], expect: [{ kind: 'current', pin: 'a', min: 0.000499, max: 0.000501 }] },
      { say: 'In bright light (1 kohm), 5 V gives 5 mA', value: 1000, drive: [vs('a', 'b', 5)], expect: [{ kind: 'current', pin: 'a', min: 0.00499, max: 0.00501 }] },
    ],
  },
  {
    name: 'Thermistor NTC 10k', prefix: 'RT', summary: 'Resistance falls as it warms: type the resistance at the temperature you want.',
    pins: [{ name: 'a', side: 'left', label: 'A' }, { name: 'b', side: 'right', label: 'B' }], param: { label: 'Resistance', unit: 'ohm', default: 10000 },
    elements: [{ kind: 'resistor', a: 'a', b: 'b', ohms: 'value' }],
    ratings: [{ kind: 'power', max: 0.25, label: '250 mW' }],
    body: body('#1e88e5', 'NTC'), fidelity: 'approximate', assumptions: ['10 kohm at 25 C.'], limits: ['Temperature is not a quantity here: you set the resistance it would have.'],
    checks: [
      { say: 'At 10 kohm, 5 V gives 0.5 mA', drive: [vs('a', 'b', 5)], expect: [{ kind: 'current', pin: 'a', min: 0.000499, max: 0.000501 }] },
      { say: 'Warm (4 kohm), 5 V gives 1.25 mA', value: 4000, drive: [vs('a', 'b', 5)], expect: [{ kind: 'current', pin: 'a', min: 0.001249, max: 0.001251 }] },
    ],
  },
];

export const STARTER_PARTS: PartDef[] = RAW.map((raw) => {
  const r = validatePart(raw);
  if (!r.ok || !r.def) throw new Error(`starter part is invalid: ${r.errors.join('; ')}`);
  return r.def;
});
