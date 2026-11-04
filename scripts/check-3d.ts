/**
 * Geometric integrity of the 3D scene, without a browser.
 *
 * Builds every fixture the way the scene does, then measures: parts overlapping
 * parts, wires inside parts, wires touching wires of another net. Fails on any.
 *
 * Run: npx tsx scripts/check-3d.ts
 */
import * as THREE from 'three';
import { ALL_FIXTURES } from '../src/fixtures/circuits';
import type { CircuitGraph } from '../src/lib/types';
import { canonicalise } from '../src/lib/circuit/graph';
import { buildComponent } from '../src/three/components';
import { layoutCircuit, type Extent, pinWorldPosition } from '../src/three/layout';
import { planNets, enteredPart, curveGap, TUBE_R, type Obstacle } from '../src/three/plan';

// A busier board than any fixture: four LED branches off one Arduino, a Pi next to
// it, and a shared ground, which is where wires start to compete for space.
const pins = ['D2', 'D3', 'D4', 'D5'];
const BUSY: CircuitGraph = {
  components: [
    { id: 'U1', type: 'arduino_uno', value: null, unit: null, pins: [], confidence: 1 } as never,
    ...pins.flatMap((_, i) => [
      { id: `R${i + 1}`, type: 'resistor', value: '220', unit: 'ohm', pins: [], confidence: 1 } as never,
      { id: `D${i + 1}`, type: 'led', value: 'red', unit: null, pins: [], confidence: 1 } as never,
    ]),
  ],
  nets: [
    ...pins.flatMap((pin, i) => [
      { id: `A${i}`, pins: [`U1.${pin}`, `R${i + 1}.a`], is_ground: false },
      { id: `B${i}`, pins: [`R${i + 1}.b`, `D${i + 1}.anode`], is_ground: false },
    ]),
    { id: 'G', pins: ['U1.GND', ...pins.map((_, i) => `D${i + 1}.cathode`)], is_ground: true },
  ],
} as never;

let failures = 0;
const cases: Record<string, CircuitGraph> = { ...ALL_FIXTURES, BUSY };
for (const [name, graph] of Object.entries(cases)) {
  const { components, nets } = canonicalise(graph);
  const built = new Map(components.map((c) => [c.id, buildComponent(c)]));
  const extents = new Map<string, Extent>();
  for (const c of components) {
    const box = new THREE.Box3().setFromObject(built.get(c.id)!.group);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    extents.set(c.id, { halfX: Math.max(size.x / 2, 0.2), halfZ: Math.max(size.z / 2, 0.2), cx: mid.x, cz: mid.z });
  }
  const { placements } = layoutCircuit(components, nets, extents);
  const pins = new Map<string, THREE.Vector3>();
  const obstacles: Obstacle[] = [];
  for (const c of components) {
    const b = built.get(c.id)!;
    const pl = placements.get(c.id)!;
    b.group.position.copy(pl.position);
    b.group.rotation.y = pl.rotationY;
    b.group.updateMatrixWorld(true);
    for (const [pin, local] of Object.entries(b.pins)) pins.set(`${c.id}.${pin}`, pinWorldPosition(pl, local));
    obstacles.push({ id: c.id, box: new THREE.Box3().setFromObject(b.group) });
  }

  const problems: string[] = [];
  for (let i = 0; i < obstacles.length; i++) {
    for (let j = i + 1; j < obstacles.length; j++) {
      if (obstacles[i].box.intersectsBox(obstacles[j].box)) problems.push(`parts ${obstacles[i].id} and ${obstacles[j].id} overlap ` + JSON.stringify([obstacles[i].box.min.toArray(), obstacles[i].box.max.toArray(), obstacles[j].box.min.toArray(), obstacles[j].box.max.toArray()].map((v) => v.map((x) => +x.toFixed(2)))) + ' rot ' + placements.get(obstacles[j].id)!.rotationY.toFixed(2));
    }
  }
  const plan = planNets(nets, pins, obstacles);
  const sampled: Array<{ netId: string; pts: THREE.Vector3[] }> = [];
  for (const n of plan) {
    for (const w of n.wires) {
      const pts = w.curve.getPoints(120);
      sampled.push({ netId: n.netId, pts });
      const a = w.curve.getPoint(0);
      const b = w.curve.getPoint(1);
      const hit = enteredPart(pts, a, b, w.ends, obstacles);
      if (hit) problems.push(`wire of ${n.netId} runs inside ${hit}`);
    }
  }
  for (let i = 0; i < sampled.length; i++) {
    for (let j = i + 1; j < sampled.length; j++) {
      if (sampled[i].netId === sampled[j].netId) continue;
      const gap = curveGap(sampled[i].pts, sampled[j].pts);
      if (gap < TUBE_R * 2) problems.push(`wires of ${sampled[i].netId} and ${sampled[j].netId} touch (${gap.toFixed(3)})`);
    }
  }
  failures += problems.length;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} ${name}${problems.length ? '\n  ' + [...new Set(problems)].join('\n  ') : ''}`);
}
// A part added after the others were placed by hand must land beside them, not
// clear across the board, and must not sit on anything.
for (const [name, graph] of Object.entries(cases)) {
  const { components, nets } = canonicalise(graph);
  const built = new Map(components.map((c) => [c.id, buildComponent(c)]));
  const extents = new Map<string, Extent>();
  for (const c of components) {
    const box = new THREE.Box3().setFromObject(built.get(c.id)!.group);
    const size = box.getSize(new THREE.Vector3());
    const mid = box.getCenter(new THREE.Vector3());
    extents.set(c.id, { halfX: Math.max(size.x / 2, 0.2), halfZ: Math.max(size.z / 2, 0.2), cx: mid.x, cz: mid.z });
  }
  const first = layoutCircuit(components, nets, extents);
  // Everything but the last part is held where the first layout put it.
  const last = components[components.length - 1].id;
  const manual = new Map([...first.placements].filter(([id]) => id !== last).map(([id, p]) => [id, { x: p.position.x, z: p.position.z, rot: p.rotationY }]));
  const second = layoutCircuit(components, nets, extents, manual);
  const problems: string[] = [];
  const boxes = components.map((c) => {
    const b = built.get(c.id)!;
    const pl = second.placements.get(c.id)!;
    b.group.position.copy(pl.position);
    b.group.rotation.y = pl.rotationY;
    b.group.updateMatrixWorld(true);
    return { id: c.id, box: new THREE.Box3().setFromObject(b.group) };
  });
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    if (boxes[i].box.intersectsBox(boxes[j].box)) problems.push(`${boxes[i].id} and ${boxes[j].id} overlap`);
  }
  for (const [id, m] of manual) {
    const p = second.placements.get(id)!;
    if (Math.hypot(p.position.x - m.x, p.position.z - m.z) > 1e-9) problems.push(`${id} was moved though it was placed by hand`);
  }
  const lastAt = second.placements.get(last)!.position;
  const nearest = Math.min(...[...manual.keys()].map((id) => Math.hypot(second.placements.get(id)!.position.x - lastAt.x, second.placements.get(id)!.position.z - lastAt.z)));
  if (components.length > 1 && nearest > 9) problems.push(`${last} landed ${nearest.toFixed(1)} units from the nearest part`);
  failures += problems.length;
  console.log(`${problems.length ? 'FAIL' : 'ok  '} added-part ${name}${problems.length ? '\n  ' + problems.join('\n  ') : ''}`);
}
if (failures) { console.log(`\n${failures} problem(s)`); process.exit(1); }
console.log('\n3D geometry clean');
