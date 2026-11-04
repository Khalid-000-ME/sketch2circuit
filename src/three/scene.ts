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
import { layoutCircuit, pinWorldPosition, type Extent, type Placement } from './layout';
import { disposeRouted, routeNets, type RoutedNet } from './wires';
import * as M from './materials';
import { BOARDS, isBoardType } from '@/lib/circuit/boards';
import { easeOutBack, easeOutCubic, prefersReducedMotion, tween, type Tween } from './anim';

export interface SceneCallbacks {
  onSelect?: (componentId: string | null) => void;
  onHover?: (componentId: string | null) => void;
  onReady?: () => void;
}

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

    canvas.addEventListener('pointermove', this.handlePointerMove);
    canvas.addEventListener('pointerdown', this.handlePointerDown);
    canvas.addEventListener('pointerleave', this.handlePointerLeave);
    this.resize();
    this.renderer.setAnimationLoop(this.tick);
  }

  // ───────────────────────────────────────────────────────────── building

  /** Replaces the whole circuit. Cheap enough to call on every edit. */
  setCircuit(components: CircuitComponent[], nets: Net[], simulation: Simulation | null, animate = true) {
    this.clearCircuit();
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
      extents.set(c.id, {
        halfX: Math.max(size.x / 2, 0.2),
        halfZ: Math.max(size.z / 2, 0.2),
      });
    }

    const { placements, board } = layoutCircuit(components, nets, extents);

    this.board = new THREE.Mesh(
      new THREE.BoxGeometry(board.width, 0.18, board.depth),
      M.fr4(),
    );
    this.board.position.y = -0.09;
    this.board.receiveShadow = true;
    this.board.name = 'board';
    this.root.add(this.board);

    // A darker lip just under the top face, so the board has a visible edge
    // rather than reading as a flat green rectangle.
    const lip = new THREE.Mesh(
      new THREE.BoxGeometry(board.width + 0.06, 0.1, board.depth + 0.06),
      M.boardEdge(),
    );
    lip.position.y = -0.14;
    lip.receiveShadow = true;
    lip.name = 'board';
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
    const positivePins = new Set<string>();
    const groundPins = new Set<string>();
    for (const c of components) {
      if (c.type === 'battery') positivePins.add(`${c.id}.pos`);
      if (isBoardType(c.type)) {
        for (const pin of [...Object.keys(BOARDS[c.type].power), 'VIN']) positivePins.add(`${c.id}.${pin}`);
        groundPins.add(`${c.id}.GND`);
      }
    }
    const { routed, group } = routeNets(nets, this.pinPositions, positivePins, groundPins);
    this.routed = routed;
    this.wireGroup = group;
    this.root.add(group);

    // Copper pads only where a lead actually meets the board. Pins that sit up on
    // a terminal — a battery's snap contacts — get no pad underneath them.
    for (const [, p] of this.pinPositions) {
      if (p.y > 0.08) continue;
      const pad = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 0.02, 14), M.copper());
      pad.position.set(p.x, 0.012, p.z);
      pad.receiveShadow = true;
      this.root.add(pad);
    }

    this.applyCurrentToLeds();
    this.computeNetCurrents(nets);
    this.frameCamera(board);
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
  private frameCamera(board: { width: number; depth: number }) {
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
    this.controls.target.set(0, 0.25, 0);
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

  // ───────────────────────────────────────────────────────────── interaction

  private pick(event: PointerEvent): string | null {
    const rect = this.canvas.getBoundingClientRect();
    this.pointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(this.pointer, this.camera);
    const hits = this.raycaster.intersectObject(this.root, true);
    for (const hit of hits) {
      const id = hit.object.userData.componentId as string | undefined;
      if (id) return id;
      if (hit.object.name === 'board') return null;
    }
    return null;
  }

  private handlePointerMove = (event: PointerEvent) => {
    const id = this.pick(event);
    if (id === this.hoveredId) return;
    this.hoveredId = id;
    this.canvas.style.cursor = id ? 'pointer' : 'grab';
    this.callbacks.onHover?.(id);
  };

  private handlePointerLeave = () => {
    if (this.hoveredId == null) return;
    this.hoveredId = null;
    this.callbacks.onHover?.(null);
  };

  private pointerDownAt: { x: number; y: number } | null = null;
  private handlePointerDown = (event: PointerEvent) => {
    this.pointerDownAt = { x: event.clientX, y: event.clientY };
    const start = this.pointerDownAt;
    const up = (e: PointerEvent) => {
      this.canvas.removeEventListener('pointerup', up);
      // A drag is an orbit, not a click.
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 5) return;
      const id = this.pick(e);
      this.select(id);
      this.callbacks.onSelect?.(id);
    };
    this.canvas.addEventListener('pointerup', up);
  };

  // ───────────────────────────────────────────────────────────── loop

  private tick = () => {
    if (!this.running) return;
    const now = performance.now();
    this.tweens = this.tweens.filter((t) => t.update(now));
    this.controls.update();

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
    this.selectedId = null;
  }

  dispose() {
    this.running = false;
    this.renderer.setAnimationLoop(null);
    this.canvas.removeEventListener('pointermove', this.handlePointerMove);
    this.canvas.removeEventListener('pointerdown', this.handlePointerDown);
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
