/**
 * Wire routing and tube generation.
 *
 * Wires arc gently above the board the way jumper leads do, which keeps them off
 * the components and makes the topology traceable from any angle. A net with more
 * than two pins gets a hub with a solder blob rather than a tangle of direct runs,
 * so a three-way junction reads as one node.
 */

import * as THREE from 'three';
import type { Net } from '@/lib/types';
import * as M from './materials';

export interface WireSegment {
  netId: string;
  mesh: THREE.Mesh;
  /** A slightly fatter transparent tube carrying the moving current dashes. */
  flow: THREE.Mesh;
  curve: THREE.Curve<THREE.Vector3>;
  /** Length in world units, used to pace the current-flow animation. */
  length: number;
}

export interface RoutedNet {
  netId: string;
  segments: WireSegment[];
  hub: THREE.Vector3 | null;
  blob?: THREE.Mesh;
  colour: number;
}

const TUBE_R = 0.045;
const LIFT = 0.42;
/** Dashes per world unit along a wire, so flow density is the same everywhere. */
const DASHES_PER_UNIT = 1.6;

let dashTexture: THREE.CanvasTexture | null = null;

/**
 * A one-dimensional dash ramp, generated once. Scrolling this along a wire is how
 * current is shown moving: the speed is proportional to the current the solver
 * computed, so a dim branch visibly crawls next to a bright one.
 */
function getDashTexture(): THREE.CanvasTexture {
  if (dashTexture) return dashTexture;
  const canvas = document.createElement('canvas');
  canvas.width = 64;
  canvas.height = 1;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createLinearGradient(0, 0, 64, 0);
  // One soft pulse per repeat, with a long dark gap, so the eye tracks motion.
  gradient.addColorStop(0, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.36, 'rgba(255,255,255,0)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.64, 'rgba(255,255,255,0)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 64, 1);
  dashTexture = new THREE.CanvasTexture(canvas);
  dashTexture.wrapS = THREE.RepeatWrapping;
  dashTexture.wrapT = THREE.ClampToEdgeWrapping;
  return dashTexture;
}

/** An arc from a to b, lifted off the board in the middle. */
function arc(a: THREE.Vector3, b: THREE.Vector3): THREE.CatmullRomCurve3 {
  const mid = new THREE.Vector3().addVectors(a, b).multiplyScalar(0.5);
  const span = a.distanceTo(b);
  const lift = Math.min(LIFT + span * 0.06, 1.1);
  const q1 = new THREE.Vector3().lerpVectors(a, b, 0.22).setY(lift * 0.85);
  const q2 = new THREE.Vector3().lerpVectors(a, b, 0.78).setY(lift * 0.85);
  mid.y = lift;
  return new THREE.CatmullRomCurve3(
    [a.clone(), q1, mid, q2, b.clone()],
    false,
    'catmullrom',
    0.4,
  );
}

function tube(curve: THREE.Curve<THREE.Vector3>, colour: number): THREE.Mesh {
  const length = curve.getLength();
  const segments = Math.max(12, Math.min(96, Math.round(length * 14)));
  const mesh = new THREE.Mesh(new THREE.TubeGeometry(curve, segments, TUBE_R, 8, false), M.sheath(colour));
  mesh.castShadow = true;
  return mesh;
}

/** The flow overlay for one wire: additive, so it reads as light rather than paint. */
function flowTube(curve: THREE.Curve<THREE.Vector3>, length: number): THREE.Mesh {
  const segments = Math.max(12, Math.min(96, Math.round(length * 14)));
  const texture = getDashTexture().clone();
  texture.needsUpdate = true;
  texture.wrapS = THREE.RepeatWrapping;
  texture.repeat.set(Math.max(1, Math.round(length * DASHES_PER_UNIT)), 1);
  const mesh = new THREE.Mesh(
    new THREE.TubeGeometry(curve, segments, TUBE_R * 1.45, 8, false),
    new THREE.MeshBasicMaterial({
      map: texture,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  mesh.renderOrder = 2;
  return mesh;
}

/** Red for the net the supply's positive terminal sits on, dark for ground. */
export function netColour(net: Net, positivePins: Set<string>, groundPins: Set<string> = new Set()): number {
  if (net.is_ground || net.pins.some((p) => groundPins.has(p))) return M.PALETTE.wireGround;
  if (net.pins.some((p) => positivePins.has(p))) return M.PALETTE.wirePositive;
  return M.PALETTE.wireSignal;
}

export function routeNets(
  nets: Net[],
  pinPositions: Map<string, THREE.Vector3>,
  positivePins: Set<string>,
  groundPins: Set<string> = new Set(),
): { routed: RoutedNet[]; group: THREE.Group } {
  const group = new THREE.Group();
  group.name = 'wires';
  const routed: RoutedNet[] = [];

  for (const net of nets) {
    const points = net.pins
      .map((ref) => ({ ref, p: pinPositions.get(ref) }))
      .filter((x): x is { ref: string; p: THREE.Vector3 } => x.p != null);
    if (points.length < 2) continue;

    const colour = netColour(net, positivePins, groundPins);
    const segments: WireSegment[] = [];
    let hub: THREE.Vector3 | null = null;
    let blob: THREE.Mesh | undefined;

    const addSegment = (curve: THREE.CatmullRomCurve3) => {
      const length = curve.getLength();
      const mesh = tube(curve, colour);
      mesh.userData.netId = net.id;
      const flow = flowTube(curve, length);
      flow.userData.netId = net.id;
      group.add(mesh);
      group.add(flow);
      segments.push({ netId: net.id, mesh, flow, curve, length });
    };

    if (points.length === 2) {
      addSegment(arc(points[0].p, points[1].p));
    } else {
      hub = new THREE.Vector3();
      for (const { p } of points) hub.add(p);
      hub.divideScalar(points.length).setY(LIFT * 0.9);

      for (const { p } of points) addSegment(arc(p, hub));
      blob = new THREE.Mesh(new THREE.SphereGeometry(TUBE_R * 2.1, 14, 10), M.sheath(colour));
      blob.position.copy(hub);
      blob.userData.netId = net.id;
      group.add(blob);
    }

    routed.push({ netId: net.id, segments, hub, blob, colour });
  }

  return { routed, group };
}

export function disposeRouted(group: THREE.Group) {
  group.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    // The flow overlays own their material and their cloned texture; the sheath
    // materials are shared by colour and must survive.
    const mat = mesh.material as THREE.Material | undefined;
    if (mat instanceof THREE.MeshBasicMaterial) {
      mat.map?.dispose();
      mat.dispose();
    }
  });
  group.clear();
}
