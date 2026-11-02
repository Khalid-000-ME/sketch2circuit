/** Hand-built circuits: bundled samples, demo fallbacks and engine tests. */

import type { CircuitGraph } from '../lib/types';

const c = (
  id: string, type: string, value: string | null = null, unit: string | null = null,
  extra: Record<string, unknown> = {},
) => ({ id, type, value, unit, orientation: null, bbox: null, mask_id: null, confidence: 0.95, pins: [], ...extra }) as never;

const n = (id: string, pins: string[], ground = false) => ({ id, pins, ...(ground ? { is_ground: true } : {}) });

/** Battery → resistor → LED. The circuit that works. */
export const SERIES_OK: CircuitGraph = {
  components: [
    c('B1', 'battery', '9', 'V'),
    c('R1', 'resistor', '330', 'ohm'),
    c('D1', 'led', 'red', null, { orientation: 'anode_left' }),
  ],
  nets: [
    n('N1', ['B1.pos', 'R1.a']),
    n('N2', ['R1.b', 'D1.anode']),
    n('N3', ['D1.cathode', 'B1.neg'], true),
  ],
};

/** The hero demo: an LED straight across a 9V battery. */
export const LED_NO_RESISTOR: CircuitGraph = {
  components: [
    c('B1', 'battery', '9', 'V'),
    c('D1', 'led', 'red', null, { orientation: 'anode_left' }),
  ],
  nets: [
    n('N1', ['B1.pos', 'D1.anode']),
    n('N2', ['D1.cathode', 'B1.neg'], true),
  ],
};

/** An undersized resistor: solves fine, but runs hot. */
export const RESISTOR_OVER_POWER: CircuitGraph = {
  components: [
    c('B1', 'battery', '9', 'V'),
    c('R1', 'resistor', '22', 'ohm'),
    c('D1', 'led', 'red'),
  ],
  nets: [
    n('N1', ['B1.pos', 'R1.a']),
    n('N2', ['R1.b', 'D1.anode']),
    n('N3', ['D1.cathode', 'B1.neg'], true),
  ],
};

/** A parallel branch, a switch and a decoupling capacitor. */
export const PARALLEL_SWITCH: CircuitGraph = {
  components: [
    c('B1', 'battery', '9', 'V'),
    c('SW1', 'switch', 'closed'),
    c('R1', 'resistor', '470', 'ohm'),
    c('R2', 'resistor', '1k', 'ohm'),
    c('D1', 'led', 'green'),
    c('C1', 'capacitor_electrolytic', '10u', 'F'),
  ],
  nets: [
    n('N1', ['B1.pos', 'SW1.a']),
    n('N2', ['SW1.b', 'R1.a', 'R2.a', 'C1.pos']),
    n('N3', ['R1.b', 'D1.anode']),
    n('N4', ['D1.cathode', 'R2.b', 'C1.neg', 'B1.neg'], true),
  ],
};

/** Electrolytic fitted backwards. */
export const ELECTROLYTIC_REVERSED: CircuitGraph = {
  components: [
    c('B1', 'battery', '9', 'V'),
    c('R1', 'resistor', '1k', 'ohm'),
    c('C1', 'capacitor_electrolytic', '100u', 'F'),
  ],
  nets: [
    n('N1', ['B1.pos', 'R1.a']),
    n('N2', ['R1.b', 'C1.neg']),
    n('N3', ['C1.pos', 'B1.neg'], true),
  ],
};

/** A dead short across the supply. */
export const SUPPLY_SHORT: CircuitGraph = {
  components: [c('B1', 'battery', '9', 'V'), c('R1', 'resistor', '220', 'ohm')],
  nets: [
    n('N1', ['B1.pos', 'B1.neg', 'R1.a'], true),
    n('N2', ['R1.b']),
  ],
};

/** A resistor with one lead going nowhere. */
export const FLOATING_BRANCH: CircuitGraph = {
  components: [
    c('B1', 'battery', '9', 'V'),
    c('R1', 'resistor', '330', 'ohm'),
    c('D1', 'led', 'red'),
    c('R2', 'resistor', '2k2', 'ohm'),
  ],
  nets: [
    n('N1', ['B1.pos', 'R1.a']),
    n('N2', ['R1.b', 'D1.anode', 'R2.a']),
    n('N3', ['D1.cathode', 'B1.neg'], true),
  ],
};

/** A motor driven through a transistor, no flyback diode, no base resistor. */
export const MOTOR_DRIVER: CircuitGraph = {
  components: [
    c('B1', 'battery', '9', 'V'),
    c('M1', 'motor', '10', 'ohm'),
    c('Q1', 'transistor', 'NPN'),
    c('SW1', 'switch', 'closed'),
  ],
  nets: [
    n('N1', ['B1.pos', 'M1.a']),
    n('N2', ['M1.b', 'Q1.collector']),
    n('N3', ['Q1.emitter', 'B1.neg'], true),
    n('N4', ['Q1.base', 'SW1.a']),
    n('N5', ['SW1.b', 'B1.pos']),
  ],
};

export const ALL_FIXTURES = {
  SERIES_OK, LED_NO_RESISTOR, RESISTOR_OVER_POWER, PARALLEL_SWITCH,
  ELECTROLYTIC_REVERSED, SUPPLY_SHORT, FLOATING_BRANCH, MOTOR_DRIVER,
};
