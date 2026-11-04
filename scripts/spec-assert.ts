/**
 * Asserted checks on reading written connections.
 * Run: npx tsx scripts/spec-assert.ts
 */
import { ALL_FIXTURES } from '../src/fixtures/circuits';
import { applySpec, specStatus } from '../src/lib/circuit/spec';
import { connectPins } from '../src/lib/circuit/edit';
import { canonicalise } from '../src/lib/circuit/graph';
import type { CircuitComponent, Net } from '../src/lib/types';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `   ${detail}`}`);
  if (!ok) failures++;
};
const sig = (nets: Net[]) => nets.map((n) => [...n.pins].sort().join('+')).sort().join(' | ');

const parts = canonicalise({ ...ALL_FIXTURES.ARDUINO_BLINK_OK, nets: [] }).components as CircuitComponent[];
const truth = sig(canonicalise(ALL_FIXTURES.ARDUINO_BLINK_OK).nets);

// 1. A table and nothing else: the whole circuit comes out of it.
let r = applySpec(parts, [], [
  { from: 'U1.D13', to: 'R1', text: 'D13 -> R1 (220)' },
  { from: 'R1', to: 'D1.anode', text: 'R1 -> LED +' },
  { from: 'D1.cathode', to: 'U1.GND', text: 'LED - -> GND' },
]);
check('a table alone builds the whole circuit', sig(r.nets) === truth, sig(r.nets));
check('a bare resistor takes one end, then the other', r.items[0].b === 'R1.a' && r.items[1].a === 'R1.b', JSON.stringify(r.items.map((i) => [i.a, i.b])));
check('no warnings for a clean table', r.warnings.length === 0, r.warnings.join(' | '));

// 2. A drawing that already says the same thing: nothing changes, everything confirmed.
const drawn = canonicalise(ALL_FIXTURES.ARDUINO_BLINK_OK).nets;
r = applySpec(parts, drawn, [{ from: 'U1.D13', to: 'R1.a' }, { from: 'D1.cathode', to: 'U1.GND' }]);
check('lines the drawing already shows are confirmed, not duplicated', sig(r.nets) === sig(drawn) && r.items.every((i) => specStatus(i, r.nets) === 'satisfied'));

// 2b. A bare resistor on a circuit that is already fully drawn names the end that
// is already there, instead of reading as a contradiction.
r = applySpec(parts, drawn, [{ from: 'U1.D13', to: 'R1', text: 'D13 -> R1' }, { from: 'R1', to: 'D1.anode', text: 'R1 -> LED +' }]);
check('a bare resistor on a drawn circuit means the end that is already there',
  r.items[0]?.b === 'R1.a' && r.items[1]?.a === 'R1.b' && r.items.every((i) => specStatus(i, r.nets) === 'satisfied'),
  JSON.stringify(r.items.map((i) => [i.a, i.b])));
check('and raises no warnings', r.warnings.length === 0, r.warnings.join(' | '));

// 3. A line that adds to a partly drawn circuit is applied.
const partial = connectPins([], 'U1.D13', 'R1.a');
r = applySpec(parts, partial, [{ from: 'R1.b', to: 'D1.anode' }, { from: 'D1.cathode', to: 'U1.GND' }]);
check('the table fills in what the drawing left out', sig(r.nets) === truth, sig(r.nets));

// 4. A line that would merge two established nets is NOT applied, and says so.
let held = connectPins([], 'U1.D13', 'D1.anode');
held = connectPins(held, 'R1.a', 'D1.cathode');
r = applySpec(parts, held, [{ from: 'U1.D13', to: 'R1.a', text: 'D13 -> R1' }]);
check('a line that would merge two nets is held back', sig(r.nets) === sig(held), sig(r.nets));
check('and reported as a conflict', r.items.length === 1 && specStatus(r.items[0], r.nets) === 'conflict' && /not applied/.test(r.warnings[0] ?? ''), r.warnings.join(' | '));

// 5. Things that cannot be read are refused, not guessed.
r = applySpec(parts, [], [
  { from: 'U1.D99', to: 'R1', text: 'D99 -> R1' },
  { from: 'R9', to: 'R1', text: 'R9 -> R1' },
  { from: 'D1', to: 'R1', text: 'LED -> R1' },
]);
check('an unknown pin is refused', /no pin "D99"/.test(r.warnings[0] ?? ''), r.warnings[0]);
check('an unknown part is refused', /not a part/.test(r.warnings[1] ?? ''), r.warnings[1]);
check('an LED with no lead named is refused, not guessed', /which lead of D1/.test(r.warnings[2] ?? ''), r.warnings[2]);
check('nothing was connected from refused lines', r.nets.length === 0);

// 6. Pin numbers as people write them.
const pi = canonicalise({ ...ALL_FIXTURES.PI_LED_OK, nets: [] }).components as CircuitComponent[];
r = applySpec(pi, [], [{ from: 'RPI1.pin 11', to: 'R1', text: 'pin 11 -> R1' }, { from: 'RPI1.GPIO 27', to: 'D1.+', text: 'GPIO27 -> LED +' }]);
check('"pin 11" means physical pin 11, which is GPIO17', r.items[0]?.a === 'RPI1.GPIO17', JSON.stringify(r.items[0]));
check('"GPIO 27" is the GPIO number', r.items[1]?.a === 'RPI1.GPIO27' && r.items[1]?.b === 'D1.anode', JSON.stringify(r.items[1]));

// 7. The same line twice is one line.
r = applySpec(parts, [], [{ from: 'U1.D13', to: 'R1.a' }, { from: 'R1.a', to: 'U1.D13' }]);
check('a repeated line is counted once', r.items.length === 1);

// 8. Status follows the circuit as it is edited.
const item = { a: 'U1.D13', b: 'R1.a' };
check('status is open before, satisfied after', specStatus(item, []) === 'open' && specStatus(item, connectPins([], item.a, item.b)) === 'satisfied');

console.log(failures ? `\n${failures} failure(s)` : '\nall assertions hold');
process.exit(failures ? 1 : 0);
