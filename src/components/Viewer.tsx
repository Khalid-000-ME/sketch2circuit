'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { CircuitComponent, Finding, Net, Simulation } from '@/lib/types';
import { CircuitScene, type WireSel } from '@/three/scene';
import type { Manual } from '@/three/layout';
import { isBoardType } from '@/lib/circuit/boards';

interface Props {
  /** Changes when a new photo is analysed. Edits keep the same id. */
  circuitId: string;
  components: CircuitComponent[];
  nets: Net[];
  simulation: Simulation | null;
  findings: Finding[];
  selectedId: string | null;
  /** Bumped by the parent to request a camera move to the selected component. */
  focusToken: number;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
  /** Where the person has put parts, so edits do not shuffle them. */
  placements: Record<string, Manual>;
  onPlace: (all: Record<string, Manual>) => void;
  onConnect: (a: string, b: string) => void;
  onDisconnect: (pin: string) => void;
  onDelete: (id: string) => void;
}

/** A key press that belongs to a form field is not ours. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);

/**
 * Whether the browser can give us a WebGL context at all (NFR-12).
 *
 * This is a fact about the environment, not React state, so it is read through
 * `useSyncExternalStore`: the server snapshot is null (render nothing yet) and
 * the client snapshot is the cached probe result. The probe is cached because
 * `getSnapshot` must return a stable value or React re-renders forever.
 */
let webglProbe: boolean | null = null;
function webglAvailable(): boolean {
  if (webglProbe != null) return webglProbe;
  try {
    const canvas = document.createElement('canvas');
    webglProbe = Boolean(canvas.getContext('webgl2') ?? canvas.getContext('webgl'));
  } catch {
    webglProbe = false;
  }
  return webglProbe;
}

const subscribeNever = () => () => {};

export default function Viewer({
  circuitId, components, nets, simulation, findings, selectedId, focusToken, onSelect, onHover,
  placements, onPlace, onConnect, onDisconnect, onDelete,
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CircuitScene | null>(null);
  const animatedCircuit = useRef<string | null>(null);
  const supported = useSyncExternalStore<boolean | null>(subscribeNever, webglAvailable, () => null);
  const [wire, setWire] = useState<WireSel | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  // The scene is built once and outlives renders, so it reaches the latest
  // handlers through a ref rather than closing over the first ones.
  const live = useRef({ onSelect, onHover, onPlace, onConnect });
  useEffect(() => { live.current = { onSelect, onHover, onPlace, onConnect }; });
  // The structural signature of the circuit: a change here rebuilds the scene,
  // while a value edit only re-runs the solver and leaves the geometry alone.
  const topology = JSON.stringify([
    components.map((c) => [c.id, c.type, c.value]),
    nets.map((n) => [n.id, n.pins]),
  ]);

  useEffect(() => {
    if (!supported || !canvasRef.current || sceneRef.current) return;
    const scene = new CircuitScene(canvasRef.current, {
      onSelect: (id) => live.current.onSelect(id),
      onHover: (id) => live.current.onHover(id),
      onPlace: (all) => live.current.onPlace(all),
      onConnect: (a, b) => live.current.onConnect(a, b),
      onSelectWire: setWire,
      onPending: setPending,
    });
    sceneRef.current = scene;
    // A hook for the browser tests, and only when asked for.
    if (window.location.search.includes('e2e')) (window as unknown as { __scene3d?: CircuitScene }).__scene3d = scene;
    const onResize = () => scene.resize();
    window.addEventListener('resize', onResize);
    const observer = new ResizeObserver(onResize);
    if (canvasRef.current.parentElement) observer.observe(canvasRef.current.parentElement);
    return () => {
      window.removeEventListener('resize', onResize);
      observer.disconnect();
      scene.dispose();
      sceneRef.current = null;
    };
    // Handlers are reached through `live`, so a parent re-render never rebuilds
    // the renderer and restarts the assembly animation.
  }, [supported]);

  // `supported` is in the dependency list because the scene is created in the
  // render pass *after* it becomes true — without it this effect runs once, finds
  // no scene, and the board is never built.
  useEffect(() => {
    const scene = sceneRef.current;
    if (!scene) return;
    scene.setFindings(findings);
    // An edit rebuilds the geometry — a 470Ω resistor has different bands from a
    // 220Ω one — but it must not replay the assembly animation.
    const firstBuild = animatedCircuit.current !== circuitId;
    animatedCircuit.current = circuitId;
    scene.setCircuit(components, nets, simulation, firstBuild, placements);
    if (selectedId) scene.select(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [topology, circuitId, supported]);

  useEffect(() => {
    sceneRef.current?.setSimulation(simulation);
  }, [simulation]);

  useEffect(() => {
    sceneRef.current?.setFindings(findings);
  }, [findings]);

  useEffect(() => {
    sceneRef.current?.select(selectedId);
  }, [selectedId]);

  useEffect(() => {
    if (focusToken > 0 && selectedId) sceneRef.current?.focus(selectedId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusToken]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      const scene = sceneRef.current;
      if (e.key === 'Escape') {
        scene?.cancelInteraction();
        onSelect(null);
      } else if ((e.key === 'r' || e.key === 'R') && selectedId && !e.metaKey && !e.ctrlKey) {
        scene?.rotateSelected();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (wire) { e.preventDefault(); onDisconnect(wire.pins[0]); setWire(null); }
        else if (selectedId) { e.preventDefault(); onDelete(selectedId); }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect, onDelete, onDisconnect, selectedId, wire]);

  const selected = components.find((c) => c.id === selectedId) ?? null;

  if (supported === false) {
    return (
      <div className="flex h-full items-center justify-center p-8 text-center">
        <div className="max-w-sm">
          <p className="text-sm text-dim">
            This browser cannot open a 3D view, so the board is not shown. The analysis and the
            findings on the right are complete and unaffected.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full touch-none"
        aria-label="Three-dimensional view of the recovered circuit. Use the component list to inspect parts without a pointer."
      />

      <button
        type="button"
        onClick={() => sceneRef.current?.fitView()}
        className="absolute right-3 top-3 h-9 rounded-md border border-edge bg-panel/80 px-3 text-[12px] text-dim backdrop-blur transition hover:border-accent/50 hover:text-ink"
      >
        Fit
      </button>

      {pending ? (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-warn/50 bg-panel/90 px-3 py-2 text-[12px] text-ink backdrop-blur">
          <span>Wiring from <span className="font-mono text-warn">{pending}</span>. Click another pin.</span>
          <button type="button" onClick={() => sceneRef.current?.cancelInteraction()} className="rounded border border-edge px-2 py-1 text-dim transition hover:text-ink">Cancel</button>
        </div>
      ) : wire ? (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-edge bg-panel/90 px-3 py-2 text-[12px] backdrop-blur">
          <span className="font-mono text-accent">{wire.pins[0]}{wire.pins[1] ? ` – ${wire.pins[1]}` : ''}</span>
          <button
            type="button"
            onClick={() => { onDisconnect(wire.pins[0]); setWire(null); }}
            className="rounded border border-edge px-2 py-1 text-dim transition hover:border-error/50 hover:text-error"
          >
            {wire.pins[1] ? 'Remove wire' : 'Disconnect pin'} <kbd className="ml-1 text-faint">Del</kbd>
          </button>
        </div>
      ) : selected ? (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-edge bg-panel/90 px-3 py-2 text-[12px] backdrop-blur">
          <span className="font-mono text-accent">{selected.id}</span>
          {!isBoardType(selected.type) && (
            <button
              type="button"
              onClick={() => sceneRef.current?.rotateSelected()}
              className="rounded border border-edge px-2 py-1 text-dim transition hover:border-accent/50 hover:text-ink"
            >
              Rotate <kbd className="ml-1 text-faint">R</kbd>
            </button>
          )}
          <button
            type="button"
            onClick={() => onDelete(selected.id)}
            className="rounded border border-edge px-2 py-1 text-dim transition hover:border-error/50 hover:text-error"
          >
            Delete <kbd className="ml-1 text-faint">Del</kbd>
          </button>
        </div>
      ) : null}
    </div>
  );
}
