/**
 * Schematic symbols.
 *
 * One definition per component type, drawn as SVG in a local coordinate space
 * whose origin is the body's centre. Every two-terminal part puts its pins at
 * ±PIN_SPAN on the local X axis, so placement and routing can treat all parts
 * uniformly and a part's rotation is the only thing that varies.
 *
 * Symbols follow the conventions a beginner will meet in a textbook or on a
 * datasheet — zigzag resistor, triangle-and-bar LED, long-and-short battery
 * plates — because the point of this view is that it is already familiar.
 */

import type { ReactNode } from 'react';
import type { CircuitComponent, ComponentType } from '@/lib/types';
import { formatValue, parseValue } from '@/lib/circuit/units';

/** Grid pitch, in SVG user units. All pins land on a multiple of this. */
export const GRID = 20;
/** Distance from body centre to each pin, for a two-terminal part. */
export const PIN_SPAN = 40;

export type Pins = Record<string, readonly [number, number]>;

export interface SymbolDef {
  pins: Pins;
  /** Half-extents including leads, for hit areas and drawing bounds. */
  half: readonly [number, number];
  /**
   * Half-extents of the drawn body alone, excluding leads. Labels are placed
   * from this: offsetting them by the pin span instead would push them past the
   * part's own leads and onto whatever wire runs there.
   */
  bodyHalf: readonly [number, number];
  draw: (c: CircuitComponent) => ReactNode;
}

const H: Pins = { a: [-PIN_SPAN, 0], b: [PIN_SPAN, 0] };
const AK: Pins = { anode: [-PIN_SPAN, 0], cathode: [PIN_SPAN, 0] };
const PN: Pins = { pos: [-PIN_SPAN, 0], neg: [PIN_SPAN, 0] };

/** A lead from the pin to the body edge. */
const lead = (x1: number, x2: number, y = 0) => (
  <line x1={x1} y1={y} x2={x2} y2={y} />
);

// ───────────────────────────────────────────────────────────────── symbols

const resistor: SymbolDef = {
  pins: H,
  half: [PIN_SPAN, 10],
  bodyHalf: [18, 9],
  draw: () => {
    // Six peaks, the conventional ANSI zigzag.
    const w = 36, peaks = 6, amp = 9;
    const step = w / peaks;
    let d = `M ${-w / 2} 0`;
    for (let i = 0; i < peaks; i++) {
      const x = -w / 2 + step * (i + 0.5);
      d += ` L ${x} ${i % 2 === 0 ? -amp : amp}`;
    }
    d += ` L ${w / 2} 0`;
    return (
      <>
        {lead(-PIN_SPAN, -w / 2)}
        <path d={d} fill="none" />
        {lead(w / 2, PIN_SPAN)}
      </>
    );
  },
};

const led: SymbolDef = {
  pins: AK,
  half: [PIN_SPAN, 16],
  // The emission arrows reach well past the triangle, and labels must clear them.
  bodyHalf: [14, 27],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -11)}
      <path d="M -11 -12 L -11 12 L 11 0 Z" />
      <line x1={11} y1={-13} x2={11} y2={13} />
      {lead(11, PIN_SPAN)}
      {/* Two emission arrows, which is what distinguishes an LED from a diode. */}
      <g className="symbol-arrow">
        <path d="M -2 -16 L 8 -26" fill="none" />
        <path d="M 8 -26 L 3 -24 M 8 -26 L 6 -21" fill="none" />
        <path d="M 6 -14 L 16 -24" fill="none" />
        <path d="M 16 -24 L 11 -22 M 16 -24 L 14 -19" fill="none" />
      </g>
    </>
  ),
};

const diode: SymbolDef = {
  pins: AK,
  half: [PIN_SPAN, 13],
  bodyHalf: [11, 12],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -10)}
      <path d="M -10 -11 L -10 11 L 10 0 Z" />
      <line x1={10} y1={-12} x2={10} y2={12} />
      {lead(10, PIN_SPAN)}
    </>
  ),
};

const battery: SymbolDef = {
  pins: PN,
  half: [PIN_SPAN, 16],
  bodyHalf: [14, 14],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -14)}
      {/* Two cells: long plate (positive), short plate, repeated. */}
      <line x1={-14} y1={-14} x2={-14} y2={14} />
      <line x1={-6} y1={-7} x2={-6} y2={7} />
      <line x1={2} y1={-14} x2={2} y2={14} />
      <line x1={10} y1={-7} x2={10} y2={7} />
      {lead(10, PIN_SPAN)}
      <text className="symbol-polarity" x={-20} y={-18}>+</text>
    </>
  ),
};

const capacitor: SymbolDef = {
  pins: H,
  half: [PIN_SPAN, 14],
  bodyHalf: [6, 13],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -5)}
      <line x1={-5} y1={-13} x2={-5} y2={13} />
      <line x1={5} y1={-13} x2={5} y2={13} />
      {lead(5, PIN_SPAN)}
    </>
  ),
};

const electrolytic: SymbolDef = {
  pins: PN,
  half: [PIN_SPAN, 14],
  bodyHalf: [9, 13],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -5)}
      <line x1={-5} y1={-13} x2={-5} y2={13} />
      {/* The curved plate is the negative side, as on a real part. */}
      <path d="M 7 -13 Q 14 0 7 13" fill="none" />
      {lead(9, PIN_SPAN)}
      <text className="symbol-polarity" x={-13} y={-17}>+</text>
    </>
  ),
};

const switchSym: SymbolDef = {
  pins: H,
  half: [PIN_SPAN, 16],
  bodyHalf: [14, 14],
  draw: (c) => {
    const open = (c.value ?? 'closed').toLowerCase() === 'open';
    return (
      <>
        {lead(-PIN_SPAN, -14)}
        <circle cx={-14} cy={0} r={2.5} className="symbol-node" />
        <circle cx={14} cy={0} r={2.5} className="symbol-node" />
        <line x1={-14} y1={0} x2={open ? 11 : 14} y2={open ? -14 : 0} />
        {lead(14, PIN_SPAN)}
      </>
    );
  },
};

const potentiometer: SymbolDef = {
  pins: { a: [-PIN_SPAN, 0], b: [PIN_SPAN, 0], wiper: [0, -PIN_SPAN] },
  half: [PIN_SPAN, PIN_SPAN],
  bodyHalf: [18, 16],
  draw: () => {
    const w = 36, peaks = 6, amp = 9;
    const step = w / peaks;
    let d = `M ${-w / 2} 0`;
    for (let i = 0; i < peaks; i++) {
      d += ` L ${-w / 2 + step * (i + 0.5)} ${i % 2 === 0 ? -amp : amp}`;
    }
    d += ` L ${w / 2} 0`;
    return (
      <>
        {lead(-PIN_SPAN, -w / 2)}
        <path d={d} fill="none" />
        {lead(w / 2, PIN_SPAN)}
        <line x1={0} y1={-PIN_SPAN} x2={0} y2={-16} />
        <path d="M -5 -16 L 5 -16 L 0 -9 Z" />
      </>
    );
  },
};

const ground: SymbolDef = {
  pins: { gnd: [0, -PIN_SPAN] },
  half: [16, PIN_SPAN],
  bodyHalf: [16, 8],
  draw: () => (
    <>
      <line x1={0} y1={-PIN_SPAN} x2={0} y2={-8} />
      <line x1={-16} y1={-8} x2={16} y2={-8} />
      <line x1={-10} y1={-2} x2={10} y2={-2} />
      <line x1={-4} y1={4} x2={4} y2={4} />
    </>
  ),
};

const transistor: SymbolDef = {
  pins: { base: [-PIN_SPAN, 0], collector: [PIN_SPAN, -PIN_SPAN], emitter: [PIN_SPAN, PIN_SPAN] },
  half: [PIN_SPAN, PIN_SPAN],
  bodyHalf: [22, 22],
  draw: () => (
    <>
      <circle cx={6} cy={0} r={22} className="symbol-envelope" fill="none" />
      {lead(-PIN_SPAN, -6)}
      <line x1={-6} y1={-14} x2={-6} y2={14} />
      <line x1={-6} y1={-7} x2={16} y2={-20} />
      <line x1={16} y1={-20} x2={PIN_SPAN} y2={-PIN_SPAN} />
      <line x1={-6} y1={7} x2={16} y2={20} />
      <line x1={16} y1={20} x2={PIN_SPAN} y2={PIN_SPAN} />
      {/* Emitter arrow: NPN points away from the base. */}
      <path d="M 16 20 L 8 17 L 11 11 Z" />
    </>
  ),
};

const inductor: SymbolDef = {
  pins: H,
  half: [PIN_SPAN, 12],
  bodyHalf: [32, 9],
  draw: () => {
    const bumps = 4, r = 8;
    let d = `M ${-bumps * r} 0`;
    for (let i = 0; i < bumps; i++) {
      d += ` A ${r} ${r} 0 0 1 ${-bumps * r + (i + 1) * 2 * r} 0`;
    }
    return (
      <>
        {lead(-PIN_SPAN, -bumps * r)}
        <path d={d} fill="none" />
        {lead(bumps * r, PIN_SPAN)}
      </>
    );
  },
};

const crystal: SymbolDef = {
  pins: H,
  half: [PIN_SPAN, 14],
  bodyHalf: [9, 13],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -9)}
      <line x1={-9} y1={-12} x2={-9} y2={12} />
      <rect x={-5} y={-13} width={10} height={26} />
      <line x1={9} y1={-12} x2={9} y2={12} />
      {lead(9, PIN_SPAN)}
    </>
  ),
};

const buzzer: SymbolDef = {
  pins: PN,
  half: [PIN_SPAN, 18],
  bodyHalf: [16, 16],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -14)}
      <path d="M -14 -16 L -14 16 L 2 16 A 16 16 0 0 0 2 -16 Z" />
      {lead(14, PIN_SPAN)}
    </>
  ),
};

const motor: SymbolDef = {
  pins: H,
  half: [PIN_SPAN, 20],
  bodyHalf: [18, 18],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -18)}
      <circle cx={0} cy={0} r={18} className="symbol-envelope" fill="none" />
      <text className="symbol-glyph" x={0} y={6}>M</text>
      {lead(18, PIN_SPAN)}
    </>
  ),
};

function dipSymbol(c: CircuitComponent): SymbolDef {
  const count = Math.max(4, c.pins.length);
  const perSide = Math.ceil(count / 2);
  const height = Math.max(60, perSide * GRID);
  const pins: Pins = {};
  c.pins.forEach((pin, i) => {
    const left = i < perSide;
    const k = i % perSide;
    const y = -height / 2 + GRID / 2 + k * GRID;
    pins[pin] = [left ? -PIN_SPAN : PIN_SPAN, Math.round(y / GRID) * GRID];
  });
  return {
    pins,
    half: [PIN_SPAN, height / 2],
    bodyHalf: [24, height / 2],
    draw: () => (
      <>
        <rect x={-24} y={-height / 2} width={48} height={height} />
        {/* Pin-1 notch, top centre, as on a real DIP. */}
        <path d={`M -6 ${-height / 2} A 6 6 0 0 0 6 ${-height / 2}`} fill="none" />
        {Object.values(pins).map(([px, py], i) => (
          <line key={i} x1={px} y1={py} x2={px < 0 ? -24 : 24} y2={py} />
        ))}
      </>
    ),
  };
}

const headerSymbol = (c: CircuitComponent): SymbolDef => {
  const count = Math.max(2, c.pins.length);
  const height = Math.max(40, count * GRID);
  const pins: Pins = {};
  c.pins.forEach((pin, i) => {
    pins[pin] = [-PIN_SPAN, -height / 2 + GRID / 2 + i * GRID];
  });
  return {
    pins,
    half: [PIN_SPAN, height / 2],
    bodyHalf: [8, height / 2],
    draw: () => (
      <>
        <rect x={-8} y={-height / 2} width={16} height={height} />
        {Object.values(pins).map(([px, py], i) => (
          <g key={i}>
            <line x1={px} y1={py} x2={-8} y2={py} />
            <circle cx={0} cy={py} r={3} className="symbol-node" />
          </g>
        ))}
      </>
    ),
  };
};

const junction: SymbolDef = {
  pins: { a: [0, 0] },
  half: [6, 6],
  bodyHalf: [4, 4],
  draw: () => <circle cx={0} cy={0} r={4} className="symbol-junction" />,
};

const unknown: SymbolDef = {
  pins: H,
  half: [PIN_SPAN, 16],
  bodyHalf: [20, 14],
  draw: () => (
    <>
      {lead(-PIN_SPAN, -20)}
      <rect x={-20} y={-14} width={40} height={28} strokeDasharray="4 3" />
      <text className="symbol-glyph" x={0} y={6}>?</text>
      {lead(20, PIN_SPAN)}
    </>
  ),
};

const STATIC: Partial<Record<ComponentType, SymbolDef>> = {
  resistor, led, diode, battery, capacitor,
  capacitor_electrolytic: electrolytic,
  switch: switchSym, potentiometer, ground, transistor,
  inductor, crystal, buzzer, motor, junction, unknown,
};

/** The symbol for a component. Pin-count-dependent types are built per instance. */
export function symbolFor(c: CircuitComponent): SymbolDef {
  if (c.type === 'ic') return dipSymbol(c);
  if (c.type === 'header') return headerSymbol(c);
  return STATIC[c.type] ?? unknown;
}

/** The label a schematic puts beside a part: "220Ω", "9V", "red". */
export function valueLabel(c: CircuitComponent): string | null {
  if (c.value == null || c.value === '') return null;
  const n = parseValue(c.value);
  if (n == null) return c.value;
  switch (c.type) {
    case 'resistor': case 'potentiometer': return formatValue(n, 'Ω');
    case 'battery': return formatValue(n, 'V');
    case 'capacitor': case 'capacitor_electrolytic': return formatValue(n, 'F');
    case 'inductor': return formatValue(n, 'H');
    case 'crystal': return formatValue(n, 'Hz');
    default: return c.value;
  }
}
