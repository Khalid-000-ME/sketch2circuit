'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CircuitComponent, Finding, Net, Simulation } from '@/lib/types';
import { arrangeSchematic } from '@/schematic/arrange';
import { boundsOf, pinPosition, type Layout2D, type Pinned } from '@/schematic/layout2d';
import { routeSchematic } from '@/schematic/route2d';
import { labelPlacement } from '@/schematic/labels';
import { GRID, symbolFor, valueLabel } from '@/schematic/symbols';
import { netOfPin } from '@/lib/circuit/edit';

/**
 * The schematic view, and the editor.
 *
 * Plain SVG rather than a canvas: a schematic is a few hundred lines and labels,
 * every one of which wants to be a hit target, a focus target and a CSS state.
 * Doing it in the DOM gets hover, selection, keyboard traversal and the fault
 * pulse almost for free, and it stays crisp at any zoom.
 *
 * Editing is direct: drag a part, click a pin and then another pin to wire them,
 * R to turn a part, Delete to remove it. Every edit goes up to the page, which
 * re-solves, so the findings change as the circuit does.
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
  /** Join two pins, named "U1.D13". */
  onConnect: (a: string, b: string) => void;
  /** Take one pin off whatever it is connected to. */
  onDisconnect: (pin: string) => void;
  onDelete: (id: string) => void;
}

interface View { x: number; y: number; scale: number }

const PADDING = 56;
/** Screen pixels a press must travel before it is a drag and not a click. */
const DRAG_SLOP = 4;

const snap = (v: number) => Math.round(v / GRID) * GRID;

/** A key press that belongs to a form field is not ours. */
const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(target.tagName);

export default function Schematic({
  circuitId, components, nets, simulation, findings, selectedId, focusToken,
  onSelect, onHover, onConnect, onDisconnect, onDelete,
}: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hovered, setHovered] = useState<string | null>(null);
  const [panning, setPanning] = useState(false);
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);

  // ── Where parts are ─────────────────────────────────────────────────────────
  /*
   * Every part is pinned where it first appears. The arrangement is only ever
   * asked to place parts it has not placed before, so connecting two pins, adding
   * a resistor or changing a value never moves what is already on the page. A
   * layout that re-ran on every edit would throw away each part a person had put
   * somewhere on purpose.
   *
   * State is adjusted during render, as React documents for state derived from
   * props, rather than in an effect that would paint one frame of the old layout.
   */
  const [frozen, setFrozen] = useState<Record<string, Pinned>>({});
  const [frozenFor, setFrozenFor] = useState(circuitId);
  if (frozenFor !== circuitId) {
    setFrozenFor(circuitId);
    setFrozen({});
  }
  const pinned = frozenFor === circuitId ? frozen : {};

  // What the layout depends on is which parts exist and what joins them, not their
  // values or the names the server gives the nets.
  const topologyKey = JSON.stringify([
    components.map((c) => [c.id, c.type]),
    nets.map((n) => [...n.pins].sort()),
  ]);
  const base = useMemo(
    () => arrangeSchematic(components, nets, pinned),
    // components and nets enter through topologyKey, deliberately.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [topologyKey, pinned],
  );

  const unplaced = components.filter((c) => !(c.id in pinned));
  if (unplaced.length > 0) {
    setFrozen((prev) => {
      const next = frozenFor === circuitId ? { ...prev } : {};
      for (const c of unplaced) {
        const p = base.placements.get(c.id);
        if (p) next[c.id] = { x: p.position.x, y: p.position.y, rotation: p.rotation };
      }
      return next;
    });
  }

  // A part being dragged follows the pointer without touching the arrangement.
  const [drag, setDrag] = useState<{ id: string; x: number; y: number } | null>(null);
  const layout = useMemo<Layout2D>(() => {
    if (!drag) return base;
    const placement = base.placements.get(drag.id);
    if (!placement) return base;
    const placements = new Map(base.placements);
    placements.set(drag.id, { ...placement, position: { x: drag.x, y: drag.y } });
    return { ...base, placements, bounds: boundsOf(components, placements) };
  }, [base, drag, components]);

  const routes = useMemo(() => routeSchematic(components, nets, layout), [components, nets, layout]);

  // ── View ────────────────────────────────────────────────────────────────────
  /*
   * The view transform is derived from the drawing's bounds and the pane's size,
   * so it is computed during render rather than synchronised into state by an
   * effect. State holds only what the viewer has done to it since — their pan and
   * zoom — and that is reset when a new circuit arrives or the pane is resized.
   */
  const fitView = useMemo<View>(() => {
    const { minX, minY, maxX, maxY } = base.bounds;
    const w = Math.max(maxX - minX, GRID);
    const h = Math.max(maxY - minY, GRID);
    if (!size.width || !size.height) return { x: 0, y: 0, scale: 1 };
    const scale = Math.min((size.width - PADDING * 2) / w, (size.height - PADDING * 2) / h, 2.1);
    return {
      scale,
      x: size.width / 2 - ((minX + maxX) / 2) * scale,
      y: size.height / 2 - ((minY + maxY) / 2) * scale,
    };
  }, [base.bounds, size.width, size.height]);

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
        const r = results[pin.slice(0, pin.lastIndexOf('.'))];
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

  // ── Wiring ──────────────────────────────────────────────────────────────────
  const [wiringFrom, setWiringFrom] = useState<string | null>(null);
  const [cursor, setCursor] = useState<{ x: number; y: number } | null>(null);

  // Looked up once per change, not once per pin per frame: a board alone has
  // twenty-odd pins, and every one of them asks "which part, which net".
  const partById = useMemo(() => new Map(components.map((c) => [c.id, c])), [components]);
  const connectedPins = useMemo(() => new Set(nets.flatMap((n) => n.pins)), [nets]);

  /** Where a pin is drawn right now, following any drag in progress. */
  const pinAt = useCallback((ref: string) => {
    const id = ref.slice(0, ref.lastIndexOf('.'));
    const pin = ref.slice(ref.lastIndexOf('.') + 1);
    const part = partById.get(id);
    const placement = layout.placements.get(id);
    const local = part ? symbolFor(part).pins[pin] : undefined;
    return placement && local ? pinPosition(placement, local) : null;
  }, [partById, layout]);

  const pinClick = (ref: string) => {
    if (!wiringFrom) { setWiringFrom(ref); return; }
    if (wiringFrom === ref) { setWiringFrom(null); return; }
    onConnect(wiringFrom, ref);
    setWiringFrom(null);
  };

  const turn = useCallback((id: string) => {
    setFrozen((prev) => {
      const placement = layout.placements.get(id);
      const current = prev[id] ?? (placement
        ? { x: placement.position.x, y: placement.position.y, rotation: placement.rotation }
        : null);
      if (!current) return prev;
      return { ...prev, [id]: { ...current, rotation: (current.rotation + 90) % 360 } };
    });
  }, [layout]);

  const selected = selectedId ? partById.get(selectedId) ?? null : null;
  const selectedDef = selected ? symbolFor(selected) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (typing(e.target)) return;
      if (e.key === 'Escape') {
        if (wiringFrom) setWiringFrom(null);
        else onSelect(null);
      } else if ((e.key === 'r' || e.key === 'R') && selected && !selectedDef?.fixed && !e.metaKey && !e.ctrlKey) {
        turn(selected.id);
      } else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) {
        e.preventDefault();
        onDelete(selected.id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onSelect, onDelete, selected, selectedDef, wiringFrom, turn]);

  // ── Pointer ─────────────────────────────────────────────────────────────────
  const toWorld = (clientX: number, clientY: number) => {
    const rect = hostRef.current?.getBoundingClientRect();
    if (!rect) return { x: 0, y: 0 };
    return { x: (clientX - rect.left - view.x) / view.scale, y: (clientY - rect.top - view.y) / view.scale };
  };

  const setHover = (id: string | null) => {
    setHovered(id);
    onHover(id);
  };

  /*
   * Zoom on the wheel. React attaches wheel listeners as passive, and a passive
   * listener may not call preventDefault, so the page would scroll while the
   * drawing zoomed and the browser would log an intervention for it. The listener
   * is attached by hand, once, and says it is not passive.
   */
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = host.getBoundingClientRect();
      const px = e.clientX - rect.left;
      const py = e.clientY - rect.top;
      // Proportional to how far the wheel moved. A fixed step per event was fine
      // for a mouse, which sends one event per notch, and wild for a trackpad,
      // which sends dozens a second. Browsers report some wheels in lines, not pixels.
      const pixels = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
      const factor = Math.exp(-Math.max(-300, Math.min(300, pixels)) * 0.0015);
      setView((v) => {
        const next = Math.min(4, Math.max(0.2, v.scale * factor));
        // Keep the point under the cursor fixed while zooming.
        return {
          scale: next,
          x: px - ((px - v.x) / v.scale) * next,
          y: py - ((py - v.y) / v.scale) * next,
        };
      });
    };
    host.addEventListener('wheel', onWheel, { passive: false });
    return () => host.removeEventListener('wheel', onWheel);
  }, []);

  // A part being pressed: where it started, and whether it has become a drag.
  const partRef = useRef<{ id: string; cx: number; cy: number; px: number; py: number; moved: boolean } | null>(null);

  const onPartDown = (e: React.PointerEvent, id: string) => {
    e.stopPropagation(); // not a pan
    (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
    const placement = layout.placements.get(id);
    if (!placement) return;
    partRef.current = { id, cx: e.clientX, cy: e.clientY, px: placement.position.x, py: placement.position.y, moved: false };
  };

  const onPointerDown = (e: React.PointerEvent) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    panRef.current = { x: e.clientX, y: e.clientY, vx: view.x, vy: view.y, moved: false };
    setPanning(true);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (wiringFrom) setCursor(toWorld(e.clientX, e.clientY));

    const part = partRef.current;
    if (part) {
      const dx = e.clientX - part.cx;
      const dy = e.clientY - part.cy;
      if (!part.moved && Math.hypot(dx, dy) < DRAG_SLOP) return;
      part.moved = true;
      setDrag({ id: part.id, x: snap(part.px + dx / view.scale), y: snap(part.py + dy / view.scale) });
      return;
    }

    const pan = panRef.current;
    if (!pan) return;
    const dx = e.clientX - pan.x;
    const dy = e.clientY - pan.y;
    if (Math.hypot(dx, dy) > DRAG_SLOP) pan.moved = true;
    setView((v) => ({ ...v, x: pan.vx + dx, y: pan.vy + dy }));
  };

  const onPointerUp = () => {
    const part = partRef.current;
    if (part?.moved && drag) {
      // Pin the part where it was dropped. The next edit will not move it.
      const placement = layout.placements.get(part.id);
      setFrozen((prev) => ({
        ...prev,
        [part.id]: { x: drag.x, y: drag.y, rotation: placement?.rotation ?? prev[part.id]?.rotation ?? 0 },
      }));
    }
    setDrag(null);
    // Whether this press moved anything is read by the click that follows it, so
    // the record is cleared on the next tick, not now.
    if (part) setTimeout(() => { if (partRef.current === part) partRef.current = null; }, 0);
    panRef.current = null;
    setPanning(false);
  };

  /** A click on empty space deselects; a drag does not. */
  const onBackgroundClick = () => {
    if (panRef.current?.moved) return;
    if (wiringFrom) { setWiringFrom(null); return; }
    onSelect(null);
  };

  const flowing = simulation?.status === 'ok';
  const wiringPin = wiringFrom ? pinAt(wiringFrom) : null;
  const wiringConnected = wiringFrom ? Boolean(netOfPin(nets, wiringFrom)) : false;

  return (
    <div
      ref={hostRef}
      className="relative h-full w-full overflow-hidden"
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerUp}
      style={{ cursor: wiringFrom ? 'crosshair' : drag ? 'grabbing' : panning ? 'grabbing' : 'grab' }}
    >
      <svg
        width={size.width || 1}
        height={size.height || 1}
        className="block touch-none select-none"
        role="img"
        aria-label="Schematic of the circuit. Every component is also listed in the panel beside it."
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
                  {net.flag && net.flags?.map((f, i) => (
                    <g key={i} className="net-flag" transform={`translate(${f.at.x} ${f.at.y})`}>
                      {net.flag!.kind === 'ground' ? (
                        // Three bars across the lead, each shorter than the last.
                        <g transform={`rotate(${Math.atan2(f.dir.y, f.dir.x) * 180 / Math.PI})`}>
                          <line x1={0} y1={-9} x2={0} y2={9} />
                          <line x1={5} y1={-6} x2={5} y2={6} />
                          <line x1={10} y1={-3} x2={10} y2={3} />
                        </g>
                      ) : (
                        <g>
                          <g transform={`rotate(${Math.atan2(f.dir.y, f.dir.x) * 180 / Math.PI})`}>
                            <line x1={0} y1={-9} x2={0} y2={9} />
                          </g>
                          <text
                            className="net-flag-label"
                            x={f.dir.x * 10 + (f.dir.x === 0 ? 0 : f.dir.x > 0 ? 4 : -4)}
                            y={f.dir.y * 12 + (f.dir.y === 0 ? 4 : f.dir.y > 0 ? 8 : -2)}
                            textAnchor={f.dir.x > 0 ? 'start' : f.dir.x < 0 ? 'end' : 'middle'}
                          >
                            {net.flag!.label}
                          </text>
                        </g>
                      )}
                    </g>
                  ))}
                </g>
              );
            })}
          </g>

          {/* The wire being drawn, from the pin that was clicked to the pointer. */}
          {wiringPin && cursor && (
            <line
              className="wire-draft"
              x1={wiringPin.x} y1={wiringPin.y} x2={cursor.x} y2={cursor.y}
            />
          )}

          {/* ── Components ────────────────────────────────────────────── */}
          {components.map((c) => {
            const placement = layout.placements.get(c.id);
            if (!placement) return null;
            const def = symbolFor(c);
            const severity = severityOf.get(c.id);
            const isSelected = c.id === selectedId;
            const label = valueLabel(c);
            // The hit area follows the part's footprint, turned with it. A square sized
            // to the longest side would, for a tall board, cover the parts beside it.
            const turned = placement.rotation % 180 !== 0;
            const hitW = Math.max(22, (turned ? def.half[1] : def.half[0]) + 4);
            const hitH = Math.max(22, (turned ? def.half[0] : def.half[1]) + 4);
            const beingDragged = drag?.id === c.id;

            return (
              <g key={c.id}>
                <g
                  className={[
                    'symbol',
                    severity === 'error' ? 'symbol--error' : '',
                    severity === 'warning' ? 'symbol--warning' : '',
                    isSelected ? 'symbol--selected' : '',
                    hovered === c.id ? 'symbol--hover' : '',
                    beingDragged ? 'symbol--dragging' : '',
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
                  className={`symbol-label${isSelected ? ' symbol-label--selected' : ''}`}
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

                {/* The hit area: the footprint, draggable, and the keyboard focus target. */}
                <rect
                  x={placement.position.x - hitW}
                  y={placement.position.y - hitH}
                  width={hitW * 2}
                  height={hitH * 2}
                  fill="transparent"
                  className="cursor-move outline-none"
                  tabIndex={0}
                  role="button"
                  aria-label={`${c.id}, ${c.type.replace(/_/g, ' ')}${label ? `, ${label}` : ''}${severity ? `, has ${severity}` : ''}`}
                  aria-pressed={isSelected}
                  onPointerDown={(e) => onPartDown(e, c.id)}
                  onPointerEnter={() => setHover(c.id)}
                  onPointerLeave={() => setHover(null)}
                  onFocus={() => setHover(c.id)}
                  onBlur={() => setHover(null)}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (partRef.current?.moved) return; // that was a drag
                    onSelect(c.id);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(c.id); }
                  }}
                />
              </g>
            );
          })}

          {/* ── Pins, above everything so they can always be reached ──── */}
          {components.flatMap((c) =>
            Object.keys(symbolFor(c).pins).map((pin) => {
              const ref = `${c.id}.${pin}`;
              const at = pinAt(ref);
              if (!at) return null;
              const connected = connectedPins.has(ref);
              return (
                <g
                  key={ref}
                  className={`pin${connected ? ' pin--connected' : ''}${wiringFrom === ref ? ' pin--source' : ''}${wiringFrom ? ' pin--armed' : ''}`}
                >
                  <circle className="pin-dot" cx={at.x} cy={at.y} r={3.6} />
                  <circle
                    className="pin-hit"
                    cx={at.x} cy={at.y} r={9}
                    role="button"
                    aria-label={`${ref}${connected ? ', connected' : ', not connected'}. Click to wire.`}
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => { e.stopPropagation(); pinClick(ref); }}
                  />
                </g>
              );
            }),
          )}
        </g>
      </svg>

      {/* What is happening, and how to get out of it. */}
      {wiringFrom ? (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-accent/40 bg-panel/90 px-3 py-2 text-[12px] text-ink backdrop-blur">
          <span>
            Wiring from <span className="font-mono text-accent">{wiringFrom}</span>. Click another pin.
          </span>
          {wiringConnected && (
            <button
              type="button"
              onClick={() => { onDisconnect(wiringFrom); setWiringFrom(null); }}
              className="rounded border border-edge px-2 py-1 text-dim transition hover:border-error/50 hover:text-error"
            >
              Disconnect
            </button>
          )}
          <button
            type="button"
            onClick={() => setWiringFrom(null)}
            className="rounded border border-edge px-2 py-1 text-dim transition hover:text-ink"
          >
            Cancel
          </button>
        </div>
      ) : selected ? (
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-md border border-edge bg-panel/90 px-3 py-2 text-[12px] backdrop-blur">
          <span className="font-mono text-accent">{selected.id}</span>
          {!selectedDef?.fixed && (
            <button
              type="button"
              onClick={() => turn(selected.id)}
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

      <div className="pointer-events-none absolute inset-x-0 bottom-3 flex justify-center">
        <p className="px-4 text-center text-[11px] text-faint">
          <span className="sm:hidden">Drag a part · tap two pins to wire</span>
          <span className="hidden sm:inline">Drag a part to move it · click a pin, then another, to wire · scroll to zoom</span>
        </p>
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
