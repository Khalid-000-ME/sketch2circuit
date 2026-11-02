'use client';

import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { CircuitComponent, Finding, Net, Simulation } from '@/lib/types';
import { CircuitScene } from '@/three/scene';

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
}

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
}: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<CircuitScene | null>(null);
  const animatedCircuit = useRef<string | null>(null);
  const supported = useSyncExternalStore<boolean | null>(subscribeNever, webglAvailable, () => null);
  // The structural signature of the circuit: a change here rebuilds the scene,
  // while a value edit only re-runs the solver and leaves the geometry alone.
  const topology = JSON.stringify([
    components.map((c) => [c.id, c.type, c.value]),
    nets.map((n) => [n.id, n.pins]),
  ]);

  useEffect(() => {
    if (!supported || !canvasRef.current || sceneRef.current) return;
    const scene = new CircuitScene(canvasRef.current, {
      onSelect,
      onHover,
    });
    sceneRef.current = scene;
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
    // The callbacks are stable for the lifetime of the page; rebuilding the whole
    // renderer when a parent re-renders would restart the assembly animation.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    scene.setCircuit(components, nets, simulation, firstBuild);
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
      if (e.key === 'Escape') onSelect(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

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
    </div>
  );
}
