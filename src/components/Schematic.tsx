'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CircuitComponent, Finding, Net, Simulation } from '@/lib/types';
import { layoutSchematic, type Placement2D } from '@/schematic/layout2d';
import { routeSchematic } from '@/schematic/route2d';
import { GRID, symbolFor, valueLabel } from '@/schematic/symbols';

/**
 * The schematic view.
 *
 * Plain SVG rather than a canvas: a schematic is a few hundred lines and labels,
 * every one of which wants to be a hit target, a focus target and a CSS state.
 * Doing it in the DOM gets hover, selection, keyboard traversal and the fault
 * pulse almost for free, and it stays crisp at any zoom.
 */

interface Props {
  circuitId: string;
  components: CircuitComponent[];
  nets: Net[];
  simulation: Simulation | null;
  findings: Finding[];
  selectedId: string | null;
  focusToken: number;
  onSelect: (id: string | null) => void;
  onHover: (id: string | null) => void;
}

interface View { x: number; y: number; scale: number }

const PADDING = 56;

export default function Schematic({
  circuitId, components, nets, simulation, findings, selectedId, focusToken, onSelect, onHover,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const dragRef = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  const layout = useMemo(() => layoutSchematic(components, nets), [components, nets]);
  const routes = useMemo(() => routeSchematic(components, nets, layout), [components, nets, layout]);

  /*
   * The view transform is derived from the drawing's bounds and the pane's size,
   * so it is computed during render rather than synchronised into state by an
   * effect. State holds only what the viewer has done to it since — their pan and
   * zoom — and that is reset when a new circuit arrives or the pane is resized,
   * using React's documented pattern for adjusting state when props change.
   */
  const fitView = useMemo<View>(() => {
    const { minX, minY, maxX, maxY } = layout.bounds;
    const w = Math.max(maxX - minX, GRID);
    const h = Math.max(maxY - minY, GRID);
    if (!size.width || !size.height) return { x: 0, y: 0, scale: 1 };
    const scale = Math.min((size.width - PADDING * 2) / w, (size.height - PADDING * 2) / h, 2.1);
    return {
      scale,
      x: size.width / 2 - ((minX + maxX) / 2) * scale,
      y: size.height / 2 - ((minY + maxY) / 2) * scale,
    };
  }, [layout.bounds, size.width, size.height]);

  const fitKey = `${circuitId}|${size.width}x${size.height}`;
  const [view, setView] = useState<View>(fitView);
  const [lastFitKey, setLastFitKey] = useState(fitKey);
  if (fitKey !== lastFitKey) {
    setLastFitKey(fitKey);
    setView(fitView);
  }

  // Focusing a component is an event, signalled by a changing token.
  const [lastFocus, setLastFocus] = useState(focusToken);
  if (focusToken !== lastFocus) {
    setLastFocus(focusToken);
    const target = selectedId ? layout.placements.get(selectedId) : null;
    if (target && size.width) {
      const scale = Math.max(view.scale, 1.1);
      setView({
        scale,
        x: size.width / 2 - target.position.x * scale,
        y: size.height / 2 - target.position.y * scale,
      });
    }
  }

  /** Severity per component, so a part can be pulsed without consulting the list. */
  const severityOf = useMemo(() => {
    const map = new Map<string, 'error' | 'warning'>();
    for (const f of findings) {
      if (!f.component_id) continue;
      if (f.severity === 'error') map.set(f.component_id, 'error');
      else if (f.severity === 'warning' && map.get(f.component_id) !== 'error') {
        map.set(f.component_id, 'warning');
      }
    }
    return map;
  }, [findings]);

  /** Current magnitude per net, for pacing the flow animation. */
  const netCurrent = useMemo(() => {
    const map = new Map<string, number>();
    const results = simulation?.component_results ?? {};
    for (const net of nets) {
      let max = 0;
      for (const pin of net.pins) {
        const r = results[pin.split('.')[0]];
        if (r) max = Math.max(max, Math.abs(r.current_a));
      }
      map.set(net.id, max);
    }
    return map;
  }, [nets, simulation]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const observer = new ResizeObserver(() => {
      setSize({ width: host.clientWidth, height: host.clientHeight });
    });
    observer.observe(host);
    setSize({ width: host.clientWidth, height: host.clientHeight });
    return () => observer.disconnect();
  }, []);

  const fit = useCallback(() => setView(fitView), [fitView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onSelect(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect]);

  const setHover = (id: string | null) => {
    setHovered(id);
    onHover(id);
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const host = hostRef.current;
    if (!host) return;
    const rect = host.getBoundingClientRect();
    const px = e.clientX - rect.left;
    const py = e.clientY - rect.top;
    setView((v) => {
      const next = Math.min(4, Math.max(0.2, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
      // Keep the point under the cursor fixed while zooming.
      return {
        scale: next,
        x: px - ((px - v.x) / v.scale) * next,
        y: py - ((py - v.y) / v.scale) * next,
      };
    });
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    setDragging(true);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const drag = dragRef.current;
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (Math.hypot(dx, dy) > 4) drag.moved = true;
    setView((v) => ({ ...v, x: drag.vx + dx, y: drag.vy + dy }));
  };
  const onPointerUp = () => {
    dragRef.current = null;
    setDragging(false);
  };

  /** A click on empty space deselects; a drag does not. */
  const onBackgroundClick = () => {
    if (dragRef.current?.moved) return;
    onSelect(null);
  };

  const flowing = simulation?.status === 'ok';

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden"
      onWheel={onWheel}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ cursor: dragging ? 'grabbing' : 'grab' }}
    >
      <svg
        width={size.width || 1}
        height={size.height || 1}
        className="block touch-none select-none"
        role="img"
        aria-label="Schematic of the recovered circuit. Every component is also listed in the panel beside it."
        onClick={onBackgroundClick}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.scale})`}>
          {/* ── Wires ─────────────────────────────────────────────────── */}
          <g className="schematic-wires">
            {routes.map((net) => {
              const amps = netCurrent.get(net.netId) ?? 0;
              // Log scale: a 1mA branch creeps, half an amp races, nothing blurs.
              const speed = amps > 1e-5 ? Math.min(2.6, 0.3 + Math.log10(amps / 1e-5) * 0.45) : 0;
              return (
                <g key={net.netId}>
                  {net.wires.map((wire) => (
                    <g key={wire.pinRef}>
                      <path
                        d={wire.d}
                        className={`wire${net.isGround ? ' wire--ground' : ''}${net.inferred ? ' wire--inferred' : ''}`}
                      />
                      {flowing && speed > 0 && (
                        <path
                          d={wire.d}
                          className="wire-flow"
                          style={{ animationDuration: `${(1 / speed).toFixed(2)}s` }}
                        />
                      )}
                    </g>
                  ))}
                  {net.showJunction && (
                    <circle cx={net.hub.x} cy={net.hub.y} r={4} className="wire-junction" />
                  )}
                </g>
              );
            })}
          </g>

          {/* ── Components ────────────────────────────────────────────── */}
          {components.map((c) => {
            const placement = layout.placements.get(c.id);
            if (!placement) return null;
            const def = symbolFor(c);
            const severity = severityOf.get(c.id);
            const selected = c.id === selectedId;
            const label = valueLabel(c);
            const hitHalf = Math.max(def.half[0], def.half[1]) + 6;

            return (
              <g key={c.id}>
                <g
                  className={[
                    'symbol',
                    severity === 'error' ? 'symbol--error' : '',
                    severity === 'warning' ? 'symbol--warning' : '',
                    selected ? 'symbol--selected' : '',
                    hovered === c.id ? 'symbol--hover' : '',
                  ].filter(Boolean).join(' ')}
                  transform={`translate(${placement.position.x} ${placement.position.y}) rotate(${placement.rotation})`}
                >
                  {def.draw(c)}
                </g>

                {/*
                  Labels stay upright whatever the body's rotation, and move to
                  the side when the part is vertical — above and below would put
                  them straight onto the part's own leads.
                */}
                <g
                  className={`symbol-label${selected ? ' symbol-label--selected' : ''}`}
                  transform={`translate(${placement.position.x} ${placement.position.y})`}
                >
                  {labelPlacement(placement).map((pos, i) => {
                    const text = i === 0 ? c.id : label;
                    if (!text) return null;
                    return (
                      <text
                        key={i}
                        className={i === 0 ? 'symbol-ref' : 'symbol-value'}
                        x={pos.x}
                        y={pos.y}
                        textAnchor={pos.anchor}
                      >
                        {text}
                      </text>
                    );
                  })}
                </g>

                {/* The hit area: generous, square, and the keyboard focus target. */}
                <rect
                  x={placement.position.x - hitHalf}
                  y={placement.position.y - hitHalf}
                  width={hitHalf * 2}
                  height={hitHalf * 2}
                  fill="transparent"
                  className="cursor-pointer outline-none"
                  tabIndex={0}
                  role="button"
                  aria-label={`${c.id}, ${c.type.replace(/_/g, ' ')}${label ? `, ${label}` : ''}${severity ? `, has ${severity}` : ''}`}
                  aria-pressed={selected}
                  onPointerEnter={() => setHover(c.id)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(c.id)}
                  onBlur={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (dragRef.current?.moved) return;
                    onSelect(c.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.id); }
                  }}
                />
              </g>
            );
          })}
        </g>
      </svg>

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <p className="text-[11px] text-faint">Drag to pan · scroll to zoom · tap a component</p>
      </div>

      <button
        type="button"
        onClick={fit}
        className="absolute right-3 top-3 h-8 rounded-md border border-edge bg-panel/80 px-2.5 text-[11px] text-dim backdrop-blur transition hover:border-accent/50 hover:text-ink"
      >
        Fit
      </button>
    </div>
  );
}

interface LabelPos { x: number; y: number; anchor: 'middle' | 'start' }

/**
 * Where the reference designator and the value sit.
 *
 * A horizontal part gets its name above and its value below, which is the
 * textbook arrangement. A vertical part gets both stacked to its right, because
 * above and below is exactly where its own leads and wires are.
 */
function labelPlacement(p: Placement2D): [LabelPos, LabelPos] {
  const vertical = p.rotation === 90 || p.rotation === 270;
  if (vertical) {
    const x = p.bodyHalf[0] + 11;
    return [
      { x, y: -3, anchor: 'start' },
      { x, y: 14, anchor: 'start' },
    ];
  }
  const y = p.bodyHalf[1];
  return [
    { x: 0, y: -y - 9, anchor: 'middle' },
    { x: 0, y: y + 19, anchor: 'middle' },
  ];
}
