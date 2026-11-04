/**
 * Asserted checks on the pure editing functions.
 * Run: npx tsx scripts/edit-assert.ts
 */
import { connectPins, disconnectPin, makeComponent, nextId, PARTS, removePart } from '../src/lib/circuit/edit';
import { canonicalise } from '../src/lib/circuit/graph';
import { solveDC } from '../src/lib/circuit/solve';
import { runRules } from '../src/lib/circuit/rules';
import type { CircuitComponent, Net } from '../src/lib/types';

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}${ok ? '' : `  ${detail}`}`);
  if (!ok) failures++;
};
const sig = (nets: Net[]) => nets.map((n) => [...n.pins].sort().join('+')).sort().join(' | ');

// connect: two bare pins make a net, a bare pin joins an existing one, two nets merge.
let nets: Net[] = [];
nets = connectPins(nets, 'R1.a', 'B1.pos');
check('two bare pins make a net', sig(nets) === 'B1.pos+R1.a', sig(nets));
nets = connectPins(nets, 'R1.a', 'D1.anode');
check('a bare pin joins an existing net', sig(nets) === 'B1.pos+D1.anode+R1.a', sig(nets));
nets = connectPins(nets, 'R2.a', 'R2.b');
nets = connectPins(nets, 'R2.b', 'R1.a');
check('two nets merge', sig(nets) === 'B1.pos+D1.anode+R1.a+R2.a+R2.b', sig(nets));
check('connecting what is already joined changes nothing', connectPins(nets, 'R1.a', 'B1.pos') === nets);
check('a pin to itself changes nothing', connectPins(nets, 'R1.a', 'R1.a') === nets);

// A ground flag survives a merge.
const g = connectPins([{ id: 'N1', pins: ['B1.neg', 'D1.cathode'], is_ground: true }, { id: 'N2', pins: ['R1.b', 'R2.b'] }], 'D1.cathode', 'R1.b');
check('ground flag survives a merge', g.length === 1 && g[0].is_ground === true);

// disconnect: a net left with one pin disappears.
let d = disconnectPin([{ id: 'N1', pins: ['A.a', 'B.a', 'C.a'] }], 'B.a');
check('disconnecting from a 3-pin net leaves a 2-pin net', sig(d) === 'A.a+C.a', sig(d));
d = disconnectPin(d, 'A.a');
check('a net left with one pin is dropped', d.length === 0);

// remove a part: its pins leave every net, and thin nets go.
const r = removePart(
  [makeComponent([], PARTS[0]), { ...makeComponent([], PARTS[1]) }],
  [{ id: 'N1', pins: ['R1.a', 'D1.anode'] }, { id: 'N2', pins: ['D1.cathode', 'R1.b', 'X.a'] }],
  'R1',
);
check('removing a part drops its pins and thin nets', sig(r.nets) === 'D1.cathode+X.a', sig(r.nets));

// ids: next free designator.
const have = [makeComponent([], PARTS[0])];
check('next id skips what is taken', nextId(have, 'resistor') === 'R2' && nextId(have, 'led') === 'D1');

// End to end: add an LED and a battery by hand, wire them with no resistor, and the
// check has to say so. This is the whole point of editing in the first place.
let comps: CircuitComponent[] = [];
const battery = makeComponent(comps, PARTS.find((p) => p.type === 'battery')!); comps = [...comps, battery];
const led = makeComponent(comps, PARTS.find((p) => p.type === 'led')!); comps = [...comps, led];
let wired = connectPins([], `${battery.id}.pos`, `${led.id}.anode`);
wired = connectPins(wired, `${led.id}.cathode`, `${battery.id}.neg`);
const canon = canonicalise({ components: comps, nets: wired });
const findings = runRules(canon, solveDC(canon), canon.floating).map((f) => f.rule);
check('a hand-built unprotected LED is flagged', findings.includes('led_no_current_limit'), findings.join(','));

// And a board can be placed and wired the same way.
const uno = makeComponent([], PARTS.find((p) => p.type === 'arduino_uno')!);
check('a board is added with all its pins', uno.pins.length > 20 && uno.pins.includes('D13') && uno.pins.includes('GND'));

console.log(failures ? `\n${failures} failure(s)` : '\nall assertions hold');
process.exit(failures ? 1 : 0);
