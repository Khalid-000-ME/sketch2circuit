/**
 * Procedural component geometry.
 *
 * Nothing here is modelled or downloaded. Every through-hole part is a small
 * parametric solid, so a new component type costs a few lines rather than an
 * asset pipeline, and a part can be built *from its value* — a 220Ω resistor
 * carries red-red-brown-gold bands because the bands are computed.
 *
 * Conventions every builder follows:
 *   • one unit = 10mm, board plane at y = 0, parts sit above it;
 *   • the part's long axis is local +X;
 *   • `userData.pins` maps each pin name to the local point a wire attaches to,
 *     always at y = 0 so wires meet the board;
 *   • `userData.bodies` lists the meshes that take fault and selection highlights.
 */

import * as THREE from 'three';
import type { CircuitComponent } from '@/lib/types';
import { parseValue, LED_VF } from '@/lib/circuit/units';
import { PI_PHYSICAL } from '@/lib/circuit/boards';
import * as M from './materials';

const LEAD_R = 0.028;
const SEG = 24;

export interface BuiltComponent {
  group: THREE.Group;
  pins: Record<string, THREE.Vector3>;
  bodies: THREE.Mesh[];
  /** Half the pin-to-pin span along X, used by the layout to reserve space. */
  halfSpan: number;
  /** The LED's inner core, so the renderer can light it with the current. */
  emitter?: THREE.Mesh;
}

// ───────────────────────────────────────────────────────────────── primitives

function cyl(
  radiusTop: number, radiusBottom: number, height: number,
  material: THREE.Material, radial = SEG,
): THREE.Mesh {
  const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radiusTop, radiusBottom, height, radial), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function box(w: number, h: number, d: number, material: THREE.Material, radius = 0): THREE.Mesh {
  const geo = radius > 0
    ? new THREE.BoxGeometry(w, h, d, 2, 2, 2)
    : new THREE.BoxGeometry(w, h, d);
  const mesh = new THREE.Mesh(geo, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

/** A lead as a tube from a to b, with a rounded cap at the board end. */
function leadBetween(a: THREE.Vector3, b: THREE.Vector3): THREE.Mesh {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = dir.length();
  const mesh = cyl(LEAD_R, LEAD_R, len, M.lead(), 10);
  mesh.position.copy(a).addScaledVector(dir, 0.5);
  mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.clone().normalize());
  return mesh;
}

/** A lead that leaves the body horizontally, then turns down to the board. */
function bentLead(from: THREE.Vector3, to: THREE.Vector3, group: THREE.Group): void {
  const knee = new THREE.Vector3(to.x, from.y, to.z);
  if (from.distanceTo(knee) > 1e-3) group.add(leadBetween(from, knee));
  if (knee.distanceTo(to) > 1e-3) group.add(leadBetween(knee, to));
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

// ───────────────────────────────────────────────────────────────── builders

function buildResistor(c: CircuitComponent): BuiltComponent {
  const group = new THREE.Group();
  const bodies: THREE.Mesh[] = [];
  const bodyLen = 0.62;
  const bodyR = 0.115;
  const halfSpan = 0.78;

  const body = cyl(bodyR, bodyR, bodyLen, M.ceramic(M.PALETTE.resistorBody));
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.16;
  group.add(body);
  bodies.push(body);

  // Tapered shoulders, so the body reads as a moulded part rather than a tube.
  for (const sign of [-1, 1]) {
    const cap = cyl(bodyR * 0.55, bodyR, 0.08, M.ceramic(M.PALETTE.resistorBody));
    cap.rotation.z = -sign * Math.PI / 2;
    cap.position.set(sign * (bodyLen / 2 + 0.04), 0.16, 0);
    group.add(cap);
    bodies.push(cap);
  }

  // Bands computed from the value.
  const bands = M.resistorBands(parseValue(c.value));
  bands.forEach((colour, i) => {
    const isTolerance = i === bands.length - 1;
    const x = isTolerance ? bodyLen * 0.34 : -bodyLen * 0.3 + i * 0.11;
    const band = cyl(bodyR * 1.03, bodyR * 1.03, isTolerance ? 0.05 : 0.045, M.ceramic(colour));
    band.rotation.z = Math.PI / 2;
    band.position.set(x, 0.16, 0);
    group.add(band);
  });

  const pins: Record<string, THREE.Vector3> = { a: V(-halfSpan, 0, 0), b: V(halfSpan, 0, 0) };
  bentLead(V(-bodyLen / 2 - 0.08, 0.16, 0), pins.a, group);
  bentLead(V(bodyLen / 2 + 0.08, 0.16, 0), pins.b, group);
  return { group, pins, bodies, halfSpan };
}

function buildLed(c: CircuitComponent): BuiltComponent {
  const group = new THREE.Group();
  const colourName = (c.value ?? 'red').toLowerCase().trim();
  const hex = ({
    red: 0xff2d2d, orange: 0xff7a1a, amber: 0xffa41a, yellow: 0xffe033,
    green: 0x33dd55, blue: 0x3399ff, white: 0xf2f6ff, uv: 0x9a6bff, ir: 0x8b1a1a,
  } as Record<string, number>)[colourName] ?? (LED_VF[colourName] ? 0xff2d2d : 0xff2d2d);

  const domeR = 0.25;
  const baseY = 0.22;
  const material = M.epoxy(hex, 0);

  const dome = new THREE.Mesh(new THREE.SphereGeometry(domeR, SEG, 16, 0, Math.PI * 2, 0, Math.PI / 2), material);
  dome.position.y = baseY + 0.3;
  dome.castShadow = true;
  group.add(dome);

  const barrel = cyl(domeR, domeR, 0.3, material);
  barrel.position.y = baseY + 0.15;
  barrel.castShadow = true;
  group.add(barrel);

  // The flat on one side marks the cathode, as on a real 5mm part.
  const flange = cyl(domeR * 1.18, domeR * 1.18, 0.07, material);
  flange.position.y = baseY + 0.035;
  group.add(flange);
  const flat = box(0.04, 0.07, domeR * 1.9, M.plastic(hex));
  flat.position.set(domeR * 1.12, baseY + 0.035, 0);
  group.add(flat);

  // The inner core: a tiny emissive chip the renderer drives from the current.
  const emitter = new THREE.Mesh(
    new THREE.SphereGeometry(0.075, 14, 10),
    new THREE.MeshPhysicalMaterial({ color: hex, emissive: new THREE.Color(hex), emissiveIntensity: 0, roughness: 0.4 }),
  );
  emitter.position.y = baseY + 0.26;
  group.add(emitter);

  const pins: Record<string, THREE.Vector3> = { anode: V(-0.13, 0, 0), cathode: V(0.13, 0, 0) };
  // The anode lead is the long one, so it starts higher inside the package.
  bentLead(V(-0.13, baseY + 0.02, 0), pins.anode, group);
  bentLead(V(0.13, baseY - 0.04, 0), pins.cathode, group);

  return { group, pins, bodies: [dome, barrel, flange], halfSpan: 0.3, emitter };
}

function buildBattery(c: CircuitComponent): BuiltComponent {
  const group = new THREE.Group();
  const volts = parseValue(c.value) ?? 9;
  const bodies: THREE.Mesh[] = [];

  if (volts >= 7) {
    // A 9V block, 48 x 26 x 17mm, laid along the local +X axis like every other
    // part so the layout's extent and orientation maths hold.
    const w = 4.8, h = 1.7, d = 2.6;
    const shell = box(w, h, d, M.paintedMetal(0x22262c));
    shell.position.y = h / 2;
    group.add(shell);
    bodies.push(shell);

    const stripe = box(w * 1.004, h * 0.26, d * 1.004, M.paintedMetal(0xd4a017));
    stripe.position.y = h * 0.72;
    group.add(stripe);

    // Terminals on the top face, at opposite ends, so + and − are unmistakable
    // and wires leave in opposite directions.
    const terminalX = w / 2 - 0.45;
    const pos = cyl(0.17, 0.2, 0.22, M.lead(), 16);
    pos.position.set(-terminalX, h + 0.11, 0);
    group.add(pos);
    const neg = cyl(0.21, 0.21, 0.22, M.lead(), 16);
    neg.position.set(terminalX, h + 0.11, 0);
    group.add(neg);

    // Wires attach at the snap terminals themselves rather than at a pad on the
    // board, which is how a PP3 is actually connected and avoids two long
    // vertical leads reading as poles.
    const pins: Record<string, THREE.Vector3> = {
      pos: V(-terminalX, h + 0.26, 0),
      neg: V(terminalX, h + 0.26, 0),
    };
    return { group, pins, bodies, halfSpan: w / 2 + 0.1 };
  }

  // A single cell, laid on its side.
  const len = 5.05, r = 0.72;
  const shell = cyl(r, r, len, M.paintedMetal(0x1f6feb));
  shell.rotation.z = Math.PI / 2;
  shell.position.y = r;
  group.add(shell);
  bodies.push(shell);

  const band = cyl(r * 1.01, r * 1.01, len * 0.3, M.paintedMetal(0xe8c547));
  band.rotation.z = Math.PI / 2;
  band.position.set(-len * 0.18, r, 0);
  group.add(band);

  const nub = cyl(0.22, 0.22, 0.14, M.lead(), 16);
  nub.rotation.z = Math.PI / 2;
  nub.position.set(-len / 2 - 0.07, r, 0);
  group.add(nub);

  // Same reasoning as the PP3: the wire meets the cell at its terminal.
  const pins: Record<string, THREE.Vector3> = {
    pos: V(-len / 2 - 0.18, r, 0),
    neg: V(len / 2 + 0.06, r, 0),
  };
  return { group, pins, bodies, halfSpan: len / 2 + 0.25 };
}

function buildCeramicCap(): BuiltComponent {
  const group = new THREE.Group();
  const mat = M.ceramic(0xd98b2b);
  // A flattened lozenge: a sphere squashed on one axis.
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.3, SEG, 16), mat);
  body.scale.set(1, 1, 0.42);
  body.position.y = 0.42;
  body.castShadow = true;
  group.add(body);

  const pins: Record<string, THREE.Vector3> = { a: V(-0.13, 0, 0), b: V(0.13, 0, 0) };
  bentLead(V(-0.13, 0.3, 0), pins.a, group);
  bentLead(V(0.13, 0.3, 0), pins.b, group);
  return { group, pins, bodies: [body], halfSpan: 0.32 };
}

function buildElectrolytic(c: CircuitComponent): BuiltComponent {
  const group = new THREE.Group();
  const farads = parseValue(c.value) ?? 10e-6;
  // Bigger capacitance, bigger can — within the range a beginner meets.
  const r = Math.min(0.52, Math.max(0.22, 0.22 + Math.log10(Math.max(farads, 1e-9) / 1e-6) * 0.09));
  const h = r * 2.1;

  const can = cyl(r, r, h, M.paintedMetal(0x1b2a4a));
  can.position.y = h / 2;
  group.add(can);
  const top = cyl(r * 0.98, r * 0.98, 0.03, M.paintedMetal(0x8d99ae));
  top.position.y = h;
  group.add(top);

  // The polarity stripe: a thin arc down the negative side.
  const stripe = new THREE.Mesh(
    new THREE.CylinderGeometry(r * 1.01, r * 1.01, h * 0.86, SEG, 1, true, Math.PI * 0.72, Math.PI * 0.56),
    M.plastic(0xc9ced6),
  );
  stripe.position.y = h / 2;
  group.add(stripe);

  const pins: Record<string, THREE.Vector3> = { pos: V(-0.13, 0, 0), neg: V(0.13, 0, 0) };
  // Longer lead on the positive side, as on a real part.
  bentLead(V(-0.13, 0.06, 0), pins.pos, group);
  bentLead(V(0.13, 0.02, 0), pins.neg, group);
  return { group, pins, bodies: [can, top], halfSpan: r + 0.12 };
}

function buildDiode(): BuiltComponent {
  const group = new THREE.Group();
  const bodyLen = 0.44, bodyR = 0.11, halfSpan = 0.7;
  const body = cyl(bodyR, bodyR, bodyLen, M.ceramic(0x23252a));
  body.rotation.z = Math.PI / 2;
  body.position.y = 0.15;
  group.add(body);

  const band = cyl(bodyR * 1.04, bodyR * 1.04, 0.07, M.ceramic(0xe6e9ee));
  band.rotation.z = Math.PI / 2;
  band.position.set(bodyLen * 0.3, 0.15, 0);
  group.add(band);

  const pins: Record<string, THREE.Vector3> = { anode: V(-halfSpan, 0, 0), cathode: V(halfSpan, 0, 0) };
  bentLead(V(-bodyLen / 2, 0.15, 0), pins.anode, group);
  bentLead(V(bodyLen / 2, 0.15, 0), pins.cathode, group);
  return { group, pins, bodies: [body, band], halfSpan };
}

function buildSwitch(c: CircuitComponent): BuiltComponent {
  const group = new THREE.Group();
  const closed = (c.value ?? 'closed').toLowerCase() !== 'open';
  const base = box(0.9, 0.22, 0.5, M.plastic(0x2a2f38));
  base.position.y = 0.11;
  group.add(base);

  // The lever pivots, so open and closed are visibly different states.
  const lever = new THREE.Group();
  const arm = box(0.62, 0.07, 0.12, M.lead());
  arm.position.x = 0.31;
  lever.add(arm);
  lever.position.set(-0.32, 0.26, 0);
  lever.rotation.z = closed ? 0 : 0.5;
  group.add(lever);

  for (const sign of [-1, 1]) {
    const contact = cyl(0.055, 0.055, 0.08, M.lead(), 12);
    contact.position.set(sign * 0.32, 0.26, 0);
    group.add(contact);
  }

  const pins: Record<string, THREE.Vector3> = { a: V(-0.55, 0, 0), b: V(0.55, 0, 0) };
  bentLead(V(-0.32, 0.1, 0), pins.a, group);
  bentLead(V(0.32, 0.1, 0), pins.b, group);
  return { group, pins, bodies: [base], halfSpan: 0.58 };
}

function buildPotentiometer(): BuiltComponent {
  const group = new THREE.Group();
  const r = 0.45;
  const body = cyl(r, r, 0.38, M.plastic(0x2f3540));
  body.position.y = 0.19;
  group.add(body);

  const shaft = cyl(0.09, 0.09, 0.3, M.lead(), 14);
  shaft.position.y = 0.52;
  group.add(shaft);

  // A knurled knob: a cylinder with enough radial segments to read as ridged.
  const knob = cyl(0.26, 0.23, 0.26, M.plastic(0x4b5563), 14);
  knob.position.y = 0.78;
  group.add(knob);

  const pins: Record<string, THREE.Vector3> = { a: V(-0.28, 0, 0.28), wiper: V(0, 0, 0.28), b: V(0.28, 0, 0.28) };
  for (const [, p] of Object.entries(pins)) bentLead(V(p.x, 0.08, 0.1), p, group);
  return { group, pins, bodies: [body, knob], halfSpan: r + 0.1 };
}

function buildTransistor(): BuiltComponent {
  const group = new THREE.Group();
  const r = 0.23, h = 0.46;
  const body = cyl(r, r, h, M.plastic(0x1c1f24));
  body.position.y = h / 2 + 0.12;
  group.add(body);
  // The clipped flat face of a TO-92.
  const flat = box(0.03, h, r * 1.9, M.plastic(0x15181c));
  flat.position.set(r * 0.92, h / 2 + 0.12, 0);
  group.add(flat);

  const pins: Record<string, THREE.Vector3> = {
    collector: V(-0.2, 0, 0), base: V(0, 0, 0.18), emitter: V(0.2, 0, 0),
  };
  for (const [, p] of Object.entries(pins)) bentLead(V(p.x * 0.5, 0.12, p.z * 0.4), p, group);
  return { group, pins, bodies: [body], halfSpan: 0.28 };
}

function buildIc(c: CircuitComponent): BuiltComponent {
  const group = new THREE.Group();
  const count = Math.max(8, c.pins.length);
  const perSide = Math.ceil(count / 2);
  const pitch = 0.254;
  const len = perSide * pitch + 0.1;
  const width = 0.78;

  const body = box(len, 0.22, width, M.plastic(0x1a1d22));
  body.position.y = 0.2;
  group.add(body);

  // The pin-1 dimple.
  const dimple = new THREE.Mesh(new THREE.CircleGeometry(0.07, 16), M.plastic(0x0d0f12));
  dimple.rotation.x = -Math.PI / 2;
  dimple.position.set(-len / 2 + 0.16, 0.311, 0);
  group.add(dimple);

  // Legs as one InstancedMesh: 8+ identical boxes, one draw call.
  const legGeo = new THREE.BoxGeometry(0.05, 0.2, 0.09);
  const legs = new THREE.InstancedMesh(legGeo, M.lead(), perSide * 2);
  legs.castShadow = true;
  const m4 = new THREE.Matrix4();
  const pins: Record<string, THREE.Vector3> = {};
  let n = 0;
  for (let side = 0; side < 2; side++) {
    for (let i = 0; i < perSide; i++) {
      const x = -len / 2 + pitch * (i + 0.5) + 0.05;
      const z = side === 0 ? width / 2 + 0.05 : -(width / 2 + 0.05);
      m4.makeTranslation(x, 0.1, z);
      legs.setMatrixAt(n, m4);
      const name = c.pins[n] ?? String(n + 1);
      pins[name] = V(x, 0, z);
      n++;
    }
  }
  legs.instanceMatrix.needsUpdate = true;
  group.add(legs);

  return { group, pins, bodies: [body], halfSpan: len / 2 + 0.1 };
}

function buildInductor(): BuiltComponent {
  const group = new THREE.Group();
  const turns = 7, coilR = 0.17, len = 0.8;
  const points: THREE.Vector3[] = [];
  for (let i = 0; i <= turns * 12; i++) {
    const t = i / (turns * 12);
    const a = t * Math.PI * 2 * turns;
    points.push(V(-len / 2 + len * t, 0.26 + Math.sin(a) * coilR, Math.cos(a) * coilR));
  }
  const curve = new THREE.CatmullRomCurve3(points);
  const coil = new THREE.Mesh(new THREE.TubeGeometry(curve, turns * 14, 0.035, 8, false), M.copper());
  coil.castShadow = true;
  group.add(coil);

  const core = cyl(0.09, 0.09, len * 1.05, M.ceramic(0x4a4039));
  core.rotation.z = Math.PI / 2;
  core.position.y = 0.26;
  group.add(core);

  const pins: Record<string, THREE.Vector3> = { a: V(-0.65, 0, 0), b: V(0.65, 0, 0) };
  bentLead(V(-len / 2, 0.26, 0), pins.a, group);
  bentLead(V(len / 2, 0.26, 0), pins.b, group);
  return { group, pins, bodies: [coil, core], halfSpan: 0.68 };
}

function buildCrystal(): BuiltComponent {
  const group = new THREE.Group();
  const body = box(0.62, 0.42, 0.22, M.paintedMetal(0xaab2bd));
  body.position.y = 0.33;
  group.add(body);
  const pins: Record<string, THREE.Vector3> = { a: V(-0.18, 0, 0), b: V(0.18, 0, 0) };
  bentLead(V(-0.18, 0.12, 0), pins.a, group);
  bentLead(V(0.18, 0.12, 0), pins.b, group);
  return { group, pins, bodies: [body], halfSpan: 0.35 };
}

function buildHeader(c: CircuitComponent): BuiltComponent {
  const group = new THREE.Group();
  const count = Math.max(2, c.pins.length);
  const pitch = 0.254;
  const len = count * pitch;
  const base = box(len, 0.22, pitch, M.plastic(0x17191d));
  base.position.y = 0.11;
  group.add(base);

  const legs = new THREE.InstancedMesh(new THREE.BoxGeometry(0.06, 0.6, 0.06), M.lead(), count);
  const m4 = new THREE.Matrix4();
  const pins: Record<string, THREE.Vector3> = {};
  for (let i = 0; i < count; i++) {
    const x = -len / 2 + pitch * (i + 0.5);
    m4.makeTranslation(x, 0.3, 0);
    legs.setMatrixAt(i, m4);
    pins[c.pins[i] ?? String(i + 1)] = V(x, 0, 0);
  }
  legs.instanceMatrix.needsUpdate = true;
  group.add(legs);
  return { group, pins, bodies: [base], halfSpan: len / 2 + 0.1 };
}

function buildBuzzer(): BuiltComponent {
  const group = new THREE.Group();
  const r = 0.55;
  const body = cyl(r, r, 0.42, M.plastic(0x16181c));
  body.position.y = 0.21;
  group.add(body);
  const vent = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.12, 20), M.plastic(0x080a0c));
  vent.rotation.x = -Math.PI / 2;
  vent.position.y = 0.422;
  group.add(vent);

  const pins: Record<string, THREE.Vector3> = { pos: V(-0.2, 0, 0.2), neg: V(0.2, 0, 0.2) };
  for (const [, p] of Object.entries(pins)) bentLead(V(p.x, 0.05, 0), p, group);
  return { group, pins, bodies: [body], halfSpan: r + 0.1 };
}

function buildMotor(): BuiltComponent {
  const group = new THREE.Group();
  const r = 0.6, len = 1.5;
  const body = cyl(r, r, len, M.paintedMetal(0x9aa3ad));
  body.rotation.z = Math.PI / 2;
  body.position.y = r;
  group.add(body);
  for (const sign of [-1, 1]) {
    const cap = cyl(r * 0.96, r * 0.96, 0.08, M.paintedMetal(0x6b727a));
    cap.rotation.z = Math.PI / 2;
    cap.position.set(sign * len / 2, r, 0);
    group.add(cap);
  }
  const shaft = cyl(0.08, 0.08, 0.5, M.lead(), 14);
  shaft.rotation.z = Math.PI / 2;
  shaft.position.set(len / 2 + 0.25, r, 0);
  group.add(shaft);

  const pins: Record<string, THREE.Vector3> = { a: V(-len / 2 - 0.2, 0, 0.18), b: V(-len / 2 - 0.2, 0, -0.18) };
  for (const [, p] of Object.entries(pins)) bentLead(V(-len / 2, r * 0.6, p.z), p, group);
  return { group, pins, bodies: [body], halfSpan: len / 2 + 0.3 };
}

function buildGround(): BuiltComponent {
  const group = new THREE.Group();
  const bodies: THREE.Mesh[] = [];
  // The schematic symbol, made solid: three bars of decreasing width.
  [[0.62, 0.06], [0.4, 0.2], [0.2, 0.34]].forEach(([w, y]) => {
    const bar = box(w, 0.05, 0.1, M.lead());
    bar.position.y = y;
    group.add(bar);
    bodies.push(bar);
  });
  const stem = cyl(LEAD_R, LEAD_R, 0.3, M.lead(), 10);
  stem.position.y = 0.48;
  group.add(stem);
  return { group, pins: { gnd: V(0, 0, 0) }, bodies, halfSpan: 0.35 };
}

function buildJunction(): BuiltComponent {
  const group = new THREE.Group();
  const blob = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), M.lead());
  blob.position.y = 0.04;
  group.add(blob);
  return { group, pins: { a: V(0, 0, 0) }, bodies: [blob], halfSpan: 0.1 };
}

function buildUnknown(): BuiltComponent {
  const group = new THREE.Group();
  const body = box(0.5, 0.3, 0.3, M.plastic(0x5a6270));
  body.position.y = 0.25;
  group.add(body);
  const pins: Record<string, THREE.Vector3> = { a: V(-0.45, 0, 0), b: V(0.45, 0, 0) };
  bentLead(V(-0.25, 0.2, 0), pins.a, group);
  bentLead(V(0.25, 0.2, 0), pins.b, group);
  return { group, pins, bodies: [body], halfSpan: 0.48 };
}


/**
 * A described part: a body with a leg for each pin it declared, on the side it
 * declared. The body's height follows what it was said to be, and its mark is
 * printed on top, so it can be told from its neighbours without opening it.
 */
function buildCustom(c: CircuitComponent): BuiltComponent {
  const def = c.custom;
  if (!def) return buildUnknown();
  const group = new THREE.Group();
  const side = (name: string) => def.pins.filter((p) => p.side === name);
  const left = side('left'), right = side('right'), top = side('top'), bottom = side('bottom');
  const pitch = 0.3;
  const w = Math.max(0.9, Math.max(top.length, bottom.length) * pitch + 0.5);
  const d = Math.max(0.7, Math.max(left.length, right.length) * pitch + 0.4);
  const h = def.body.tall ? 0.7 : 0.38;
  const lift = 0.14;

  const body = box(w, h, d, M.plastic(def.body.colour), 0.02);
  body.position.y = lift + h / 2;
  group.add(body);

  const pins: Record<string, THREE.Vector3> = {};
  const legs = (list: typeof left, at: (i: number, n: number) => [number, number], out: [number, number]) => {
    list.forEach((p, i) => {
      const [x, z] = at(i, list.length);
      const tip = V(x + out[0] * 0.28, 0, z + out[1] * 0.28);
      pins[p.name] = tip;
      bentLead(V(x, lift + 0.08, z), tip, group);
    });
  };
  const along = (n: number, i: number) => (i - (n - 1) / 2) * pitch;
  legs(left, (i, n) => [-w / 2, along(n, i)], [-1, 0]);
  legs(right, (i, n) => [w / 2, along(n, i)], [1, 0]);
  legs(top, (i, n) => [along(n, i), -d / 2], [0, -1]);
  legs(bottom, (i, n) => [along(n, i), d / 2], [0, 1]);

  // The mark, where there is a screen to draw it on.
  const text = (def.body.mark || def.name).slice(0, 6).toUpperCase();
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = 128; canvas.height = 64;
    const ctx = canvas.getContext('2d');
    if (ctx) {
      ctx.fillStyle = 'rgba(255,255,255,0.88)';
      ctx.font = '600 34px ui-monospace, monospace';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 64, 34);
      const mark = new THREE.Mesh(
        new THREE.PlaneGeometry(Math.min(w * 0.8, 0.9), Math.min(w * 0.8, 0.9) / 2),
        new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(canvas), transparent: true, depthWrite: false }),
      );
      mark.rotation.x = -Math.PI / 2;
      mark.position.y = lift + h + 0.003;
      group.add(mark);
    }
  }
  return { group, pins, bodies: [body], halfSpan: w / 2 + 0.3 };
}

// ───────────────────────────────────────────────────────────────── boards

/** One header strip: a black plastic block and a row of gold pins standing out of it. */
function headerStrip(
  group: THREE.Group, x0: number, z: number, count: number, baseY: number,
  rows = 1, rowGap = 0.254,
): { top: number } {
  const pitch = 0.254;
  const height = 0.85;
  const block = box(count * pitch, height, rows * pitch, M.plastic(0x16181c));
  block.position.set(x0 + (count * pitch) / 2 - pitch / 2, baseY + height / 2, z + ((rows - 1) * rowGap) / 2);
  group.add(block);

  const pinGeo = new THREE.BoxGeometry(0.06, 0.34, 0.06);
  const pins = new THREE.InstancedMesh(pinGeo, M.lead(), count * rows);
  const m4 = new THREE.Matrix4();
  let n = 0;
  for (let r = 0; r < rows; r++) {
    for (let i = 0; i < count; i++) {
      m4.makeTranslation(x0 + i * pitch, baseY + height + 0.12, z + r * rowGap);
      pins.setMatrixAt(n++, m4);
    }
  }
  pins.instanceMatrix.needsUpdate = true;
  group.add(pins);
  return { top: baseY + height + 0.27 };
}

const BOARD_TOP = 0.24; // top face of the PCB, above its standoffs

function buildArduinoUno(): BuiltComponent {
  const group = new THREE.Group();
  const L = 6.86, W = 5.34;
  const pins: Record<string, THREE.Vector3> = {};

  const pcb = box(L, 0.16, W, M.solderMask(0x00474c));
  pcb.position.y = BOARD_TOP - 0.08;
  group.add(pcb);

  // Connectors on the left edge, hanging a little past it as they do on the real board.
  const usb = box(1.6, 1.1, 1.2, M.steel());
  usb.position.set(-L / 2 + 0.55, BOARD_TOP + 0.55, -1.0);
  group.add(usb);
  const jack = box(1.5, 1.1, 0.9, M.plastic(0x14161a));
  jack.position.set(-L / 2 + 0.6, BOARD_TOP + 0.55, 1.55);
  group.add(jack);

  // The ATmega328 and the things around it.
  const chip = box(3.5, 0.45, 0.78, M.plastic(0x15171b));
  chip.position.set(0.55, BOARD_TOP + 0.225, 0.55);
  group.add(chip);
  const notch = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), M.plastic(0x08090b));
  notch.rotation.x = -Math.PI / 2;
  notch.position.set(-1.05, BOARD_TOP + 0.452, 0.55);
  group.add(notch);
  const crystal = box(0.55, 0.3, 0.3, M.steel());
  crystal.position.set(-1.9, BOARD_TOP + 0.15, 0.2);
  group.add(crystal);
  const reset = box(0.5, 0.3, 0.5, M.plastic(0xc43a31));
  reset.position.set(-2.0, BOARD_TOP + 0.15, -1.95);
  group.add(reset);
  for (const [x, z, c] of [[0.5, -0.4, 0x2fe06a], [0.85, -0.4, 0xffc14a]] as const) {
    const led = box(0.2, 0.08, 0.12, M.plastic(c));
    led.position.set(x, BOARD_TOP + 0.04, z);
    group.add(led);
  }

  // Headers. The pin names are the ones the schematic uses; unnamed sockets are
  // decoration, because the model has no use for SCL, SDA, AREF or IOREF.
  const pitch = 0.254;
  const topZ = -W / 2 + 0.36;
  const botZ = W / 2 - 0.36;
  const rowA = ['', '', '', 'GND', 'D13', 'D12', 'D11', 'D10', 'D9', 'D8'];
  const rowB = ['D7', 'D6', 'D5', 'D4', 'D3', 'D2', 'D1', 'D0'];
  const rowC = ['', '', 'RESET', '3V3', '5V', '', '', 'VIN'];
  const rowD = ['A0', 'A1', 'A2', 'A3', 'A4', 'A5'];
  const strips: Array<[string[], number, number]> = [
    [rowA, -1.9, topZ], [rowB, 1.04, topZ], [rowC, -0.95, botZ], [rowD, 1.55, botZ],
  ];
  let top = BOARD_TOP + 1.1;
  for (const [names, x0, z] of strips) {
    top = headerStrip(group, x0, z, names.length, BOARD_TOP).top;
    names.forEach((name, i) => { if (name) pins[name] = V(x0 + i * pitch, top, z); });
  }

  return { group, pins, bodies: [pcb], halfSpan: L / 2 + 0.1 };
}

function buildRaspberryPi(): BuiltComponent {
  const group = new THREE.Group();
  const L = 8.56, W = 5.65;
  const pins: Record<string, THREE.Vector3> = {};

  const pcb = box(L, 0.16, W, M.solderMask(0x064420));
  pcb.position.y = BOARD_TOP - 0.08;
  group.add(pcb);

  // The system-on-chip under its heat spreader, and the memory beside it.
  const soc = box(1.5, 0.2, 1.5, M.steel());
  soc.position.set(-1.0, BOARD_TOP + 0.1, 0.45);
  group.add(soc);
  const ram = box(1.2, 0.14, 1.3, M.plastic(0x15171b));
  ram.position.set(0.7, BOARD_TOP + 0.07, 0.4);
  group.add(ram);

  // The right-hand edge: two USB stacks and the Ethernet port.
  const eth = box(2.1, 1.35, 1.6, M.steel());
  eth.position.set(L / 2 - 1.0, BOARD_TOP + 0.675, 1.9);
  group.add(eth);
  for (const z of [-0.05, -1.75]) {
    const usb = box(2.2, 1.55, 1.45, M.steel());
    usb.position.set(L / 2 - 1.05, BOARD_TOP + 0.775, z);
    group.add(usb);
  }

  // The bottom edge and the left: power, HDMI, audio, and the card slot.
  const power = box(0.9, 0.35, 0.8, M.steel());
  power.position.set(-L / 2 + 1.1, BOARD_TOP + 0.175, W / 2 - 0.4);
  group.add(power);
  for (const x of [-1.9, -0.55]) {
    const hdmi = box(0.75, 0.35, 0.65, M.steel());
    hdmi.position.set(x, BOARD_TOP + 0.175, W / 2 - 0.33);
    group.add(hdmi);
  }
  const sd = box(1.5, 0.12, 1.2, M.steel());
  sd.position.set(-L / 2 + 0.7, BOARD_TOP - 0.1, 0);
  group.add(sd);

  // The 40-pin header: two rows along the top edge, odd pins on the inner row.
  const pitch = 0.254;
  const hx0 = -1.5 - 19 * pitch / 2;
  const hz = -W / 2 + 0.38;
  const top = headerStrip(group, hx0, hz, 20, BOARD_TOP, 2, pitch).top;
  const seen = new Set<string>();
  for (let n = 1; n <= 40; n++) {
    const name = PI_PHYSICAL[n];
    if (!name || name.startsWith('ID_') || seen.has(name)) continue;
    seen.add(name);
    const col = Math.floor((n - 1) / 2);
    // Odd pins sit on the row nearer the middle of the board, even ones on the edge.
    pins[name] = V(hx0 + col * pitch, top, hz + (n % 2 === 1 ? pitch : 0));
  }

  return { group, pins, bodies: [pcb], halfSpan: L / 2 + 0.1 };
}

// ───────────────────────────────────────────────────────────────── factory

const BUILDERS: Record<string, (c: CircuitComponent) => BuiltComponent> = {
  resistor: buildResistor,
  led: buildLed,
  battery: buildBattery,
  capacitor: buildCeramicCap,
  capacitor_electrolytic: buildElectrolytic,
  diode: buildDiode,
  switch: buildSwitch,
  potentiometer: buildPotentiometer,
  transistor: buildTransistor,
  ic: buildIc,
  inductor: buildInductor,
  crystal: buildCrystal,
  header: buildHeader,
  buzzer: buildBuzzer,
  motor: buildMotor,
  ground: buildGround,
  junction: buildJunction,
  arduino_uno: buildArduinoUno,
  raspberry_pi: buildRaspberryPi,
  custom: buildCustom,
  unknown: buildUnknown,
};

/** Builds one component. Every mesh is tagged so picking resolves to the part. */
export function buildComponent(c: CircuitComponent): BuiltComponent {
  const built = (BUILDERS[c.type] ?? buildUnknown)(c);

  // Materials are shared by substance, which is what keeps draw calls down — but
  // the fault pulse and the selection highlight write to the body material, and a
  // shared material would light every resistor on the board at once. So each
  // component's highlightable bodies get their own clone. Leads, bands and legs
  // stay shared, since nothing ever writes to those.
  for (const body of built.bodies) {
    const mat = body.material;
    if (mat && !Array.isArray(mat)) body.material = (mat as THREE.Material).clone();
  }

  built.group.name = c.id;
  built.group.userData.componentId = c.id;
  built.group.userData.pins = built.pins;
  built.group.userData.bodies = built.bodies;
  built.group.traverse((o) => { o.userData.componentId = c.id; });
  return built;
}

export function disposeBuilt(built: BuiltComponent) {
  built.group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
  });
  // Only the per-instance clones are ours to dispose; the cached ones are shared.
  for (const body of built.bodies) {
    const mat = body.material;
    if (mat && !Array.isArray(mat)) (mat as THREE.Material).dispose();
  }
  const emitterMat = built.emitter?.material;
  if (emitterMat && !Array.isArray(emitterMat)) (emitterMat as THREE.Material).dispose();
}
