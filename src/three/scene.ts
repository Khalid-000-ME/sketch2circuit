/**
 * The renderer: scene graph, image-based lighting, camera, picking and the
 * animation loop.
 *
 * Image-based lighting is doing most of the work here. A RoomEnvironment through
 * a PMREM generator costs three lines and no download, and it is the entire
 * difference between "this renders" and "this looks like a photograph of a
 * board". There is exactly one directional light, for contact shadows. Stacking
 * point lights would look worse, not better.
 */

import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { CircuitComponent, Finding, Net, Simulation } from '@/lib/types';
import { buildComponent, disposeBuilt, type BuiltComponent } from './components';
import { footprintAt, layoutCircuit, pinWorldPosition, type Extent, type Manual, type Placement } from './layout';
import { disposeRouted, routeNets, type RoutedNet } from './wires';
import * as M from './materials';
import { BOARDS, isBoardType } from '@/lib/circuit/boards';
import { easeOutBack, easeOutCubic, prefersReducedMotion, tween, type Tween } from './anim';

/** A wire the person picked: the net, and the pin at its start (and end, unless it ends at a junction). */
export interface WireSel {
  netId: string;
  pins: [string, string | null];
}

export interface SceneCallbacks {
  onSelect?: (componentId: string | null) => void;
  onHover?: (componentId: string | null) => void;
  onReady?: () => void;
  /** Called after parts are moved or turned, with every part's position. */
  onPlace?: (all: Record<string, Manual>) => void;
  onConnect?: (a: string, b: string) => void;
  onSelectWire?: (wire: WireSel | null) => void;
  /** The pin a wire has been started from, or null when none is pending. */
  onPending?: (pin: string | null) => void;
}

type Hit =
  | { kind: 'pin'; ref: string }
  | { kind: 'wire'; wire: WireSel }
  | { kind: 'part'; id: string }
  | null;

/** Grid a dragged part snaps to, and the air kept between parts. */
const DRAG_STEP = 0.254;
const PART_GAP = 0.3;

interface Placed {
  component: CircuitComponent;
  built: BuiltComponent;
  placement: Placement;
  outline: THREE.Mesh | null;
  /** Non-null while this part is pulsing because a finding implicates it. */
  faultSeverity: 'error' | 'warning' | null;
}

const UP = new THREE.Vector3(0, 1, 0);

export class CircuitScene {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private controls: OrbitControls;
  private pmrem: THREE.PMREMGenerator;
  private raycaster = new THREE.Raycaster();
  private pointer = new THREE.Vector2();
  private frame = 0;
  private running = true;

  private root = new THREE.Group();
  private board: THREE.Mesh | null = null;
  private wireGroup: THREE.Group | null = null;
  private routed: RoutedNet[] = [];
  private placed = new Map<string, Placed>();
  private pinPositions = new Map<string, THREE.Vector3>();
  private tweens: Tween[] = [];

  private selectedId: string | null = null;
  private hoveredId: string | null = null;
  private simulation: Simulation | null = null;
  /** net id -> current magnitude in amps, for the flow animation. */
  private netCurrent = new Map<string, number>();
  private lastFrameTime = performance.now();

  // Editing state.
  private manual = new Map<string, Manual>();
  private extents = new Map<string, Extent>();
  private currentNets: Net[] = [];
  private positivePins = new Set<string>();
  private groundPins = new Set<string>();
  private padGroup: THREE.Group | null = null;
  private pinGroup: THREE.Group | null = null;
  private lip: THREE.Mesh | null = null;
  private hoverRing: THREE.Mesh;
  private pendingRing: THREE.Mesh;
  private hoverPin: string | null = null;
  private pendingPin: string | null = null;
  private wireSel: WireSel | null = null;
  private wireHighlight: THREE.Mesh | null = null;
  private wiresDirty = false;
  private plane = new THREE.Plane(UP, 0);
  /** The last board the layout produced, so the view can be refitted on demand. */
  private boardSize: { width: number; depth: number; cx: number; cz: number } = { width: 6, depth: 5, cx: 0, cz: 0 };
  private drag: { id: string; grab: THREE.Vector3; start: { x: number; y: number }; moved: boolean; last: { x: number; z: number } } | null = null;

  constructor(private canvas: HTMLCanvasElement, private callbacks: SceneCallbacks = {}) {
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 400);
    this.camera.position.set(6.5, 7.5, 9.5);

    this.pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = this.pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 1.0;

    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(5, 11, 6);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 46;
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.bias = -0.0012;
    key.shadow.normalBias = 0.022;
    this.scene.add(key);

    this.controls = new OrbitControls(this.camera, canvas);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.08;
    this.controls.minDistance = 3;
    this.controls.maxDistance = 48;
    this.controls.maxPolarAngle = Math.PI * 0.49;
    this.controls.target.set(0, 0.3, 0);

    this.scene.add(this.root);

    const ring = (colour: number) => {
      const mesh = new THREE.Mesh(
        new THREE.TorusGeometry(0.19, 0.022, 10, 28),
        new THREE.MeshBasicMaterial({ color: colour, transparent: true, opacity: 0.95, depthTest: false }),
      );
      mesh.rotation.x = Math.PI / 2;
      mesh.renderOrder = 5;
      mesh.visible = false;
      this.scene.add(mesh);
      return mesh;
    };
    this.hoverRing = ring(0x6ee7ff);
    this.pendingRing = ring(0xffb020);

    canvas.addEventListener('pointermove', this.handlePointerMove);
    // Capture phase: the orbit controls must be switched off before they see the
    // press, or grabbing a part would also spin the camera.
    canvas.addEventListener('pointerdown', this.handlePointerDown, { capture: true });
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  // ───────────────────────────────────────────────────────────── building

  /** Replaces the whole circuit. Cheap enough to call on every edit. */
  setCircuit(
    components: CircuitComponent[], nets: Net[], simulation: Simulation | null, animate = true,
    manual?: Record<string, Manual>,
  ) {
    if (manual) this.manual = new Map(Object.entries(manual).filter(([id]) => components.some((c) => c.id === id)));
    this.clearCircuit();
    this.currentNets = nets;
    this.simulation = simulation;
    if (components.length === 0) return;

    // Build first, so the layout knows how much room each part needs. The extents
    // are measured from the geometry rather than declared by each builder, so a
    // part can never claim less board than it occupies.
    const builtById = new Map<string, BuiltComponent>();
    const extents = new Map<string, Extent>();
    const measure = new THREE.Box3();
    for (const c of components) {
      const built = buildComponent(c);
      builtById.set(c.id, built);
      measure.setFromObject(built.group);
      const size = measure.getSize(new THREE.Vector3());
      const middle = measure.getCenter(new THREE.Vector3());
      extents.set(c.id, {
        halfX: Math.max(size.x / 2, 0.2),
        halfZ: Math.max(size.z / 2, 0.2),
        cx: middle.x,
        cz: middle.z,
      });
    }

    this.extents = extents;
    const { placements, board } = layoutCircuit(components, nets, extents, this.manual);

    this.board = new THREE.Mesh(
      new THREE.BoxGeometry(board.width, 0.18, board.depth),
      M.fr4(),
    );
    this.board.position.set(board.cx, -0.09, board.cz);
    this.board.receiveShadow = true;
    this.board.name = 'board';
    this.root.add(this.board);

    // A darker lip just under the top face, so the board has a visible edge
    // rather than reading as a flat green rectangle.
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(board.width + 0.06, 0.1, board.depth + 0.06),
      M.boardEdge(),
    );
    lip.position.set(board.cx, -0.14, board.cz);
    lip.receiveShadow = true;
    lip.name = 'board';
    this.lip = lip;
    this.root.add(lip);

    this.pinPositions.clear();
    for (const c of components) {
      const built = builtById.get(c.id)!;
      const placement = placements.get(c.id)!;
      built.group.position.copy(placement.position);
      built.group.rotation.y = placement.rotationY;
      this.root.add(built.group);

      for (const [pin, local] of Object.entries(built.pins)) {
        this.pinPositions.set(`${c.id}.${pin}`, pinWorldPosition(placement, local));
      }
      this.placed.set(c.id, { component: c, built, placement, outline: null, faultSeverity: null });
    }

    // Supply pins draw red and ground pins dark, whether they belong to a battery
    // or to a board.
    this.positivePins = new Set<string>();
    this.groundPins = new Set<string>();
    for (const c of components) {
      if (c.type === 'battery') this.positivePins.add(`${c.id}.pos`);
      if (isBoardType(c.type)) {
        for (const pin of [...Object.keys(BOARDS[c.type].power), 'VIN']) this.positivePins.add(`${c.id}.${pin}`);
        this.groundPins.add(`${c.id}.GND`);
      }
    }
    this.rebuildWires();

    this.applyCurrentToLeds();
    this.computeNetCurrents(nets);
    this.boardSize = { width: board.width, depth: board.depth, cx: board.cx ?? 0, cz: board.cz ?? 0 };
    // A new circuit is framed from scratch. A rebuilt one keeps the camera where
    // the person left it — unless that would leave a part off-screen, where they
    // could neither see nor click it. Adding a part grows the board, so without
    // this a part could sit outside the canvas with no way to reach it.
    if (animate) this.frameCamera(board);
    else if (!this.everythingVisible()) this.fitView();
    if (animate && !prefersReducedMotion()) this.playAssembly(components, nets);
    this.callbacks.onReady?.();
  }

  /** The money shot: parts pop in, in net order, then the wires draw on. */
  private playAssembly(components: CircuitComponent[], nets: Net[]) {
    // Order by how far each part is from the supply, so the circuit builds outward.
    const order = assemblyOrder(components, nets);
    const stagger = 80;

    order.forEach((id, i) => {
      const entry = this.placed.get(id);
      if (!entry) return;
      const target = entry.built.group;
      // Scale, not opacity: materials are shared by substance, so fading one part
      // would fade every part made of the same stuff.
      target.scale.setScalar(0.001);
      target.visible = false;
      this.tweens.push(tween({
        durationMs: 440,
        delayMs: i * stagger,
        ease: easeOutBack,
        onUpdate: (t) => {
          target.visible = true;
          target.scale.setScalar(Math.max(0.001, t));
        },
        onComplete: () => { target.scale.setScalar(1); target.visible = true; },
      }));
    });

    if (this.wireGroup) {
      const wireDelay = order.length * stagger * 0.55;
      for (const net of this.routed) {
        for (const seg of net.segments) {
          const geo = seg.mesh.geometry as THREE.TubeGeometry;
          const total = geo.index ? geo.index.count : geo.attributes.position.count;
          geo.setDrawRange(0, 0);
          this.tweens.push(tween({
            durationMs: 340,
            delayMs: wireDelay,
            onUpdate: (t) => geo.setDrawRange(0, Math.ceil(total * t)),
            onComplete: () => geo.setDrawRange(0, Infinity),
          }));
        }
      }
    }
  }

  /**
   * Frames the whole board, from an angle that reads as a photograph of a desk.
   * The distance comes from the board's bounding radius and the camera's own
   * field of view, so a two-part circuit and a fifteen-part one both fill the
   * frame the same way.
   */
  private frameCamera(board: { width: number; depth: number; cx?: number; cz?: number }) {
    const radius = Math.hypot(board.width, board.depth) / 2;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(this.camera.aspect, 0.2));
    // The tighter of the two half-angles decides the distance, so a tall narrow
    // phone pane pulls back far enough to keep the whole board in frame.
    const half = Math.min(vFov, hFov) / 2;
    const dist = Math.max(4.5, (radius * 1.06) / Math.sin(half));

    // 38 degrees of elevation: high enough to read the topology, low enough that
    // the parts still have silhouettes.
    const elevation = THREE.MathUtils.degToRad(38);
    const azimuth = THREE.MathUtils.degToRad(28);
    this.camera.position.set(
      Math.sin(azimuth) * Math.cos(elevation) * dist,
      Math.sin(elevation) * dist,
      Math.cos(azimuth) * Math.cos(elevation) * dist,
    );
    this.controls.target.set(board.cx ?? 0, 0.25, board.cz ?? 0);
    this.controls.update();
  }

  /** Whether every part and pin projects inside the canvas, with a margin. */
  private everythingVisible(): boolean {
    this.camera.updateMatrixWorld(true);
    const inside = (v: THREE.Vector3) => {
      const p = v.clone().project(this.camera);
      return p.z < 1 && p.x >= -0.94 && p.x <= 0.94 && p.y >= -0.94 && p.y <= 0.94;
    };
    for (const e of this.placed.values()) if (!inside(e.placement.position.clone().setY(0.3))) return false;
    for (const [, p] of this.pinPositions) if (!inside(p)) return false;
    return true;
  }

  /**
   * Pulls back to fit the whole board, keeping the angle the person is looking
   * from. `frameCamera` chooses an angle as well, which is right for a new
   * circuit and wrong for an edit: it would spin the board out from under them.
   */
  fitView() {
    const { width, depth, cx, cz } = this.boardSize;
    const radius = Math.hypot(width, depth) / 2;
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * Math.max(this.camera.aspect, 0.2));
    const half = Math.min(vFov, hFov) / 2;
    const dist = Math.max(4.5, (radius * 1.12) / Math.sin(half));
    const target = new THREE.Vector3(cx, 0.25, cz);
    const dir = this.camera.position.clone().sub(this.controls.target);
    if (dir.lengthSq() < 1e-6) dir.set(0.5, 0.7, 0.9);
    dir.normalize();
    this.camera.position.copy(target).addScaledVector(dir, dist);
    this.controls.target.copy(target);
    this.controls.update();
  }

  // ───────────────────────────────────────────────────────────── state

  setSimulation(simulation: Simulation | null) {
    this.simulation = simulation;
    this.applyCurrentToLeds();
    this.computeNetCurrents(this.routed.map((r) => ({ id: r.netId, pins: this.netPins.get(r.netId) ?? [] })));
  }

  private netPins = new Map<string, string[]>();

  /**
   * The current carried by each net.
   *
   * A net's current is the largest magnitude among the devices on it. For a
   * series chain that is exactly right; for a branch point it is the dominant
   * path, which is what the eye should follow anyway.
   */
  private computeNetCurrents(nets: Array<{ id: string; pins: string[] }>) {
    this.netCurrent.clear();
    this.netPins.clear();
    const results = this.simulation?.component_results ?? {};
    for (const net of nets) {
      this.netPins.set(net.id, net.pins);
      let max = 0;
      for (const pin of net.pins) {
        const r = results[pin.split('.')[0]];
        if (r) max = Math.max(max, Math.abs(r.current_a));
      }
      this.netCurrent.set(net.id, max);
    }
  }

  /** Lights each LED in proportion to the current actually flowing through it. */
  private applyCurrentToLeds() {
    for (const [id, entry] of this.placed) {
      const emitter = entry.built.emitter;
      if (!emitter) continue;
      const result = this.simulation?.component_results[id];
      const mA = result ? Math.abs(result.current_a) * 1000 : 0;
      // 20mA is a comfortably lit LED; beyond that it is not brighter, just dying.
      const lit = Math.min(1, mA / 20);
      const mat = emitter.material as THREE.MeshPhysicalMaterial;
      mat.emissiveIntensity = lit * 3.2;
      mat.needsUpdate = true;
    }
  }

  /** Marks the components named by findings so they pulse. */
  setFindings(findings: Finding[]) {
    for (const entry of this.placed.values()) entry.faultSeverity = null;
    for (const f of findings) {
      if (!f.component_id) continue;
      const entry = this.placed.get(f.component_id);
      if (!entry) continue;
      if (f.severity === 'error') entry.faultSeverity = 'error';
      else if (f.severity === 'warning' && entry.faultSeverity !== 'error') entry.faultSeverity = 'warning';
    }
  }

  select(componentId: string | null, focusCamera = false) {
    if (this.selectedId === componentId && !focusCamera) return;
    this.selectedId = componentId;
    for (const [id, entry] of this.placed) this.setOutline(entry, id === componentId ? M.PALETTE.select : null);
    if (focusCamera && componentId) this.focus(componentId);
  }

  /** Eases the camera to look at one component. */
  focus(componentId: string) {
    const entry = this.placed.get(componentId);
    if (!entry) return;
    const target = entry.placement.position.clone().setY(0.35);
    const from = this.controls.target.clone();
    const camFrom = this.camera.position.clone();
    const offset = this.camera.position.clone().sub(this.controls.target);
    const desired = offset.clone().setLength(Math.max(4.2, Math.min(offset.length(), 9)));
    const camTo = target.clone().add(desired);
    if (prefersReducedMotion()) {
      this.controls.target.copy(target);
      this.camera.position.copy(camTo);
      this.controls.update();
      return;
    }
    this.tweens.push(tween({
      durationMs: 420,
      ease: easeOutCubic,
      onUpdate: (t) => {
        this.controls.target.lerpVectors(from, target, t);
        this.camera.position.lerpVectors(camFrom, camTo, t);
      },
    }));
  }

  /** A back-face shell, which is far cheaper than pulling in a composer chain. */
  private setOutline(entry: Placed, colour: number | null) {
    if (entry.outline) {
      entry.outline.parent?.remove(entry.outline);
      entry.outline.geometry.dispose();
      entry.outline = null;
    }
    if (colour == null) return;
    const body = entry.built.bodies[0];
    if (!body) return;
    const shell = new THREE.Mesh(body.geometry.clone(), M.outline(colour));
    shell.position.copy(body.position);
    shell.rotation.copy(body.rotation);
    shell.scale.copy(body.scale).multiplyScalar(1.1);
    shell.renderOrder = -1;
    shell.userData.componentId = entry.component.id;
    entry.built.group.add(shell);
    entry.outline = shell;
  }

  // ───────────────────────────────────────────────────────────── building, live

  /** Routes every wire again from where the pins are now, with pads and pick targets. */
  private rebuildWires() {
    if (this.wireGroup) { disposeRouted(this.wireGroup); this.root.remove(this.wireGroup); this.wireGroup = null; }
    const obstacles = [...this.placed.values()].map((e) => {
      e.built.group.updateMatrixWorld(true);
      return { id: e.component.id, box: new THREE.Box3().setFromObject(e.built.group) };
    });
    const { routed, group } = routeNets(this.currentNets, this.pinPositions, this.positivePins, this.groundPins, obstacles);
    this.routed = routed;
    this.wireGroup = group;
    this.root.add(group);
    this.refreshPads();
    this.refreshPins();
    this.refreshWireHighlight();
  }

  /** Copper pads only where a lead meets the board; a pin up on a terminal gets none. */
  private refreshPads() {
    if (this.padGroup) {
      this.padGroup.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); });
      this.root.remove(this.padGroup);
    }
    const pads = new THREE.Group();
    for (const [, p] of this.pinPositions) {
      if (p.y > 0.08) continue;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 14), M.copper());
      pad.position.set(p.x, 0.012, p.z);
      pad.receiveShadow = true;
      pads.add(pad);
    }
    this.padGroup = pads;
    this.root.add(pads);
  }

  /** One invisible target per pin. They are what a wire is started and ended on. */
  private refreshPins() {
    if (this.pinGroup) {
      this.pinGroup.traverse((o) => { (o as THREE.Mesh).geometry?.dispose(); });
      this.root.remove(this.pinGroup);
    }
    const pins = new THREE.Group();
    const material = new THREE.MeshBasicMaterial({ visible: false });
    for (const [ref, p] of this.pinPositions) {
      const target = new THREE.Mesh(new THREE.SphereGeometry(0.15, 8, 6), material);
      target.position.copy(p).setY(Math.max(p.y, 0.05));
      target.userData.pinRef = ref;
      pins.add(target);
    }
    this.pinGroup = pins;
    this.root.add(pins);
    this.placeRing(this.pendingRing, this.pendingPin);
    this.placeRing(this.hoverRing, this.hoverPin);
  }

  private placeRing(ring: THREE.Mesh, ref: string | null) {
    const p = ref ? this.pinPositions.get(ref) : null;
    ring.visible = Boolean(p);
    if (p) ring.position.copy(p).setY(Math.max(p.y, 0.05) + 0.02);
  }

  private refreshWireHighlight() {
    if (this.wireHighlight) {
      this.wireHighlight.geometry.dispose();
      (this.wireHighlight.material as THREE.Material).dispose();
      this.root.remove(this.wireHighlight);
      this.wireHighlight = null;
    }
    const sel = this.wireSel;
    if (!sel) return;
    const seg = this.routed.flatMap((r) => r.segments).find((x) => {
      const pins = x.mesh.userData.wirePins as [string, string | null] | undefined;
      return x.netId === sel.netId && pins?.[0] === sel.pins[0];
    });
    if (!seg) return;
    this.wireHighlight = new THREE.Mesh(
      new THREE.TubeGeometry(seg.curve, 64, 0.085, 8, false),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.4, depthWrite: false }),
    );
    this.wireHighlight.renderOrder = 3;
    this.root.add(this.wireHighlight);
  }

  /** Fits the board to wherever the parts now are. */
  private fitBoard() {
    if (!this.board || !this.lip) return;
    const MARGIN = 1.15;
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const e of this.placed.values()) {
      const ext = this.extents.get(e.component.id);
      if (!ext) continue;
      const f = footprintAt(ext, e.placement.rotationY, e.placement.position.x, e.placement.position.z);
      minX = Math.min(minX, f.mx - f.dx); maxX = Math.max(maxX, f.mx + f.dx);
      minZ = Math.min(minZ, f.mz - f.dz); maxZ = Math.max(maxZ, f.mz + f.dz);
    }
    if (!Number.isFinite(minX)) return;
    const width = Math.max(4, maxX - minX + MARGIN * 2);
    const depth = Math.max(3.5, maxZ - minZ + MARGIN * 2);
    const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
    this.board.geometry.dispose();
    this.board.geometry = new THREE.BoxGeometry(width, 0.18, depth);
    this.board.position.set(cx, -0.09, cz);
    this.lip.geometry.dispose();
    this.lip.geometry = new THREE.BoxGeometry(width + 0.06, 0.1, depth + 0.06);
    this.lip.position.set(cx, -0.14, cz);
  }

  // ───────────────────────────────────────────────────────────── editing

  /** Whether a part at this spot would sit on another. */
  private overlaps(id: string, x: number, z: number, rotationY: number): boolean {
    const mine = this.extents.get(id);
    if (!mine) return false;
    const a = footprintAt(mine, rotationY, x, z);
    for (const other of this.placed.values()) {
      if (other.component.id === id) continue;
      const ext = this.extents.get(other.component.id);
      if (!ext) continue;
      const b = footprintAt(ext, other.placement.rotationY, other.placement.position.x, other.placement.position.z);
      if (a.dx + b.dx + PART_GAP > Math.abs(a.mx - b.mx) && a.dz + b.dz + PART_GAP > Math.abs(a.mz - b.mz)) return true;
    }
    return false;
  }

  /** The nearest free grid spot to (x, z), found by widening rings. */
  private freeSpot(id: string, x: number, z: number, rotationY: number): { x: number; z: number } {
    if (!this.overlaps(id, x, z, rotationY)) return { x, z };
    for (let r = 1; r <= 40; r++) {
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const cx = x + dx * DRAG_STEP, cz = z + dz * DRAG_STEP;
          if (!this.overlaps(id, cx, cz, rotationY)) return { x: cx, z: cz };
        }
      }
    }
    return { x, z };
  }

  private moveTo(id: string, x: number, z: number, rotationY?: number) {
    const entry = this.placed.get(id);
    if (!entry) return;
    entry.placement.position.set(x, 0, z);
    if (rotationY != null) entry.placement.rotationY = rotationY;
    entry.built.group.position.set(x, 0, z);
    entry.built.group.rotation.y = entry.placement.rotationY;
    for (const [pin, local] of Object.entries(entry.built.pins)) {
      this.pinPositions.set(`${id}.${pin}`, pinWorldPosition(entry.placement, local));
    }
    this.wiresDirty = true;
  }

  /** Once anything is placed by hand, everything is: the rest must not drift. */
  private freezeAll() {
    for (const e of this.placed.values()) {
      this.manual.set(e.component.id, { x: e.placement.position.x, z: e.placement.position.z, rot: e.placement.rotationY });
    }
    this.callbacks.onPlace?.(Object.fromEntries(this.manual));
  }

  /** Turns the selected part a quarter turn. Boards stay as they are built. */
  rotateSelected() {
    const id = this.selectedId;
    const entry = id ? this.placed.get(id) : null;
    if (!id || !entry || isBoardType(entry.component.type)) return;
    const rot = entry.placement.rotationY + Math.PI / 2;
    const spot = this.freeSpot(id, entry.placement.position.x, entry.placement.position.z, rot);
    this.moveTo(id, spot.x, spot.z, rot);
    this.fitBoard();
    this.freezeAll();
  }

  /** For tests: where things are, and where they appear on screen. */
  inspect() {
    const rect = this.canvas.getBoundingClientRect();
    const project = (v: THREE.Vector3) => {
      const p = v.clone().project(this.camera);
      return { x: rect.left + ((p.x + 1) / 2) * rect.width, y: rect.top + ((1 - p.y) / 2) * rect.height };
    };
    return {
      parts: Object.fromEntries([...this.placed.values()].map((e) => [
        e.component.id,
        { x: e.placement.position.x, z: e.placement.position.z, rot: e.placement.rotationY, screen: project(e.placement.position.clone().setY(0.3)) },
      ])),
      pins: Object.fromEntries([...this.pinPositions].map(([ref, v]) => [ref, project(v.clone().setY(Math.max(v.y, 0.05)))])),
      wires: this.routed.flatMap((r) => r.segments.map((s) => ({ net: r.netId, pins: s.mesh.userData.wirePins as [string, string | null], screen: project(s.curve.getPoint(0.5)) }))),
      nets: this.currentNets.map((n) => n.pins),
    };
  }

  /** For tests: what a press at this screen point would land on. */
  hitTest(clientX: number, clientY: number) {
    return this.hitAt({ clientX, clientY } as PointerEvent);
  }

  setWire(wire: WireSel | null) {
    this.wireSel = wire;
    this.refreshWireHighlight();
  }

  /** Drops a half-made wire and any wire selection. */
  cancelInteraction() {
    this.setPending(null);
    if (this.wireSel) { this.wireSel = null; this.refreshWireHighlight(); this.callbacks.onSelectWire?.(null); }
  }

  private setPending(ref: string | null) {
    if (this.pendingPin === ref) return;
    this.pendingPin = ref;
    this.placeRing(this.pendingRing, ref);
    this.callbacks.onPending?.(ref);
  }

  // ───────────────────────────────────────────────────────────── interaction

  private rayFrom(event: PointerEvent) {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
  }

  private hitAt(event: PointerEvent): Hit {
    this.rayFrom(event);
    const hits = this.raycaster.intersectObject(this.root, true);
    let other: { hit: Hit; distance: number } | null = null;
    let pin: { ref: string; distance: number } | null = null;
    for (const hit of hits) {
      const u = hit.object.userData;
      if (u.pinRef) { pin ??= { ref: u.pinRef as string, distance: hit.distance }; continue; }
      if (other) continue;
      if (u.wirePins) other = { hit: { kind: 'wire', wire: { netId: u.netId as string, pins: u.wirePins as [string, string | null] } }, distance: hit.distance };
      else if (u.componentId) other = { hit: { kind: 'part', id: u.componentId as string }, distance: hit.distance };
      else if (hit.object.name === 'board') other = { hit: null, distance: hit.distance };
    }
    // A pin is a small target, often sitting against the stud or lead it belongs
    // to, so it wins over whatever is almost exactly as near.
    if (pin && (!other || pin.distance <= other.distance + 0.25)) return { kind: 'pin', ref: pin.ref };
    return other?.hit ?? null;
  }

  private planePoint(event: PointerEvent): THREE.Vector3 | null {
    this.rayFrom(event);
    return this.raycaster.ray.intersectPlane(this.plane, new THREE.Vector3());
  }

  private handlePointerMove = (event: PointerEvent) => {
    if (this.drag) { this.dragMove(event); return; }
    const hit = this.hitAt(event);
    const pin = hit?.kind === 'pin' ? hit.ref : null;
    if (pin !== this.hoverPin) { this.hoverPin = pin; this.placeRing(this.hoverRing, pin); }
    const id = hit?.kind === 'part' ? hit.id : null;
    this.canvas.style.cursor = pin ? 'crosshair' : hit?.kind === 'wire' ? 'pointer' : id ? 'grab' : 'default';
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.callbacks.onHover?.(id);
  };

  private handlePointerLeave = () => {
    if (this.hoverPin) { this.hoverPin = null; this.hoverRing.visible = false; }
    if (this.hoveredId == null) return;
    this.hoveredId = null;
    this.callbacks.onHover?.(null);
  };

  private dragMove(event: PointerEvent) {
    const d = this.drag;
    if (!d) return;
    if (!d.moved && Math.hypot(event.clientX - d.start.x, event.clientY - d.start.y) < 5) return;
    d.moved = true;
    this.canvas.style.cursor = 'grabbing';
    const entry = this.placed.get(d.id);
    const p = this.planePoint(event);
    if (!entry || !p) return;
    let x = Math.round((p.x - d.grab.x) / DRAG_STEP) * DRAG_STEP;
    let z = Math.round((p.z - d.grab.z) / DRAG_STEP) * DRAG_STEP;
    const rot = entry.placement.rotationY;
    // Never into another part: if the pointer's spot is taken, slide along the
    // one axis that is free, and otherwise stay where it last was.
    if (this.overlaps(d.id, x, z, rot)) {
      if (!this.overlaps(d.id, x, d.last.z, rot)) z = d.last.z;
      else if (!this.overlaps(d.id, d.last.x, z, rot)) x = d.last.x;
      else return;
    }
    if (x === d.last.x && z === d.last.z) return;
    d.last = { x, z };
    this.moveTo(d.id, x, z);
  }

  private handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    const hit = this.hitAt(event);
    const start = { x: event.clientX, y: event.clientY };

    if (hit?.kind === 'part') {
      const entry = this.placed.get(hit.id);
      const p = this.planePoint(event);
      if (entry && p) {
        // Orbit would also take this press; it is off until the button is up.
        this.controls.enabled = false;
        this.drag = {
          id: hit.id,
          grab: p.sub(entry.placement.position),
          start,
          moved: false,
          last: { x: entry.placement.position.x, z: entry.placement.position.z },
        };
      }
    }

    const up = (e: PointerEvent) => {
      window.removeEventListener('pointerup', up);
      this.controls.enabled = true;
      const dragged = this.drag?.moved === true;
      this.drag = null;
      if (dragged) {
        this.fitBoard();
        this.freezeAll();
        this.canvas.style.cursor = 'grab';
        return;
      }
      // A drag elsewhere is an orbit, not a click.
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
      this.click(this.hitAt(e));
    };
    window.addEventListener('pointerup', up);
  };

  private click(hit: Hit) {
    if (hit?.kind === 'pin') {
      if (this.pendingPin == null) this.setPending(hit.ref);
      else if (this.pendingPin === hit.ref) this.setPending(null);
      else {
        const from = this.pendingPin;
        this.setPending(null);
        this.callbacks.onConnect?.(from, hit.ref);
      }
      return;
    }
    this.setPending(null);
    if (hit?.kind === 'wire') {
      this.wireSel = hit.wire;
      this.refreshWireHighlight();
      this.select(null);
      this.callbacks.onSelect?.(null);
      this.callbacks.onSelectWire?.(hit.wire);
      return;
    }
    if (this.wireSel) { this.wireSel = null; this.refreshWireHighlight(); this.callbacks.onSelectWire?.(null); }
    const id = hit?.kind === 'part' ? hit.id : null;
    this.select(id);
    this.callbacks.onSelect?.(id);
  }

  // ───────────────────────────────────────────────────────────── loop

  private tick = () => {
    if (!this.running) return;
    const now = performance.now();
    this.tweens = this.tweens.filter((t) => t.update(now));
    this.controls.update();
    if (this.wiresDirty) { this.wiresDirty = false; this.rebuildWires(); }

    const reduced = prefersReducedMotion();
    const t = now / 1000;

    for (const entry of this.placed.values()) {
      const severity = entry.faultSeverity;
      const bodies = entry.built.bodies;
      if (!bodies.length) continue;
      if (!severity) {
        for (const b of bodies) {
          const mat = b.material as THREE.MeshPhysicalMaterial;
          if (mat.emissiveIntensity && mat !== (entry.built.emitter?.material as THREE.Material)) {
            mat.emissiveIntensity = 0;
          }
        }
        continue;
      }
      const colour = severity === 'error' ? M.PALETTE.fault : M.PALETTE.warn;
      const pulse = reduced ? 0.42 : 0.3 + 0.25 * Math.sin(t * 3);
      for (const b of bodies) {
        const mat = b.material as THREE.MeshPhysicalMaterial;
        mat.emissive.setHex(colour);
        mat.emissiveIntensity = pulse;
      }
    }

    // Current flow: the dash overlay scrolls at a speed set by the net's current.
    const dt = Math.min((now - this.lastFrameTime) / 1000, 0.05);
    this.lastFrameTime = now;
    const flowing = !reduced && this.simulation?.status === 'ok';
    for (const net of this.routed) {
      const amps = this.netCurrent.get(net.netId) ?? 0;
      // A log scale: 1mA still visibly creeps, 500mA races, and nothing is a blur.
      const visible = flowing && amps > 1e-5;
      const speed = visible ? Math.min(1.6, 0.12 + Math.log10(amps / 1e-5) * 0.22) : 0;
      for (const seg of net.segments) {
        const mat = seg.flow.material as THREE.MeshBasicMaterial;
        const target = visible ? 0.5 : 0;
        mat.opacity += (target - mat.opacity) * 0.12;
        seg.flow.visible = mat.opacity > 0.01;
        if (!visible || !mat.map) continue;
        // Negative, because the tube is built from the first pin toward the second
        // and the texture should travel the same way.
        mat.map.offset.x = (mat.map.offset.x - speed * dt) % 1;
      }
    }

    this.frame++;
    this.renderer.render(this.scene, this.camera);
  };

  resize() {
    const parent = this.canvas.parentElement;
    const width = parent?.clientWidth ?? window.innerWidth;
    const height = parent?.clientHeight ?? window.innerHeight;
    if (width === 0 || height === 0) return;
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
  }

  private clearCircuit() {
    for (const t of this.tweens) t.cancel();
    this.tweens = [];
    if (this.wireGroup) { disposeRouted(this.wireGroup); this.root.remove(this.wireGroup); this.wireGroup = null; }
    this.routed = [];
    for (const entry of this.placed.values()) disposeBuilt(entry.built);
    for (const child of [...this.root.children]) {
      child.traverse?.((o) => {
        const mesh = o as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
      });
      this.root.remove(child);
    }
    this.placed.clear();
    this.pinPositions.clear();
    this.board = null;
    this.lip = null;
    this.padGroup = null;
    this.pinGroup = null;
    this.wireHighlight = null;
    this.selectedId = null;
    this.drag = null;
    this.hoverRing.visible = false;
    this.pendingRing.visible = false;
    if (this.pendingPin) { this.pendingPin = null; this.callbacks.onPending?.(null); }
    if (this.wireSel) { this.wireSel = null; this.callbacks.onSelectWire?.(null); }
  }

  dispose() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown, { capture: true });
    this.canvas.removeEventListener('pointerleave', this.handlePointerLeave);
    this.clearCircuit();
    this.controls.dispose();
    this.pmrem.dispose();
    this.renderer.dispose();
  }
}

// ───────────────────────────────────────────────────────────── helpers

/** Breadth-first from the supply, so the circuit assembles the way current flows. */
function assemblyOrder(components: CircuitComponent[], nets: Net[]): string[] {
  const adjacency = new Map<string, Set<string>>();
  for (const net of nets) {
    const ids = [...new Set(net.pins.map((p) => p.split('.')[0]))];
    for (const a of ids) {
      const set = adjacency.get(a) ?? new Set<string>();
      for (const b of ids) if (b !== a) set.add(b);
      adjacency.set(a, set);
    }
  }
  const start = components.find((c) => c.type === 'battery')?.id ?? components[0]?.id;
  const seen = new Set<string>();
  const order: string[] = [];
  const queue = start ? [start] : [];
  while (queue.length) {
    const id = queue.shift()!;
    if (seen.has(id)) continue;
    seen.add(id);
    order.push(id);
    for (const next of adjacency.get(id) ?? []) if (!seen.has(next)) queue.push(next);
  }
  for (const c of components) if (!seen.has(c.id)) order.push(c.id);
  return order;
}

export { UP };
