/** Parsing and normalising the handwritten values the vision stage reads. */

const PREFIX: Record<string, number> = {
  p: 1e-12, n: 1e-9, u: 1e-6, µ: 1e-6, μ: 1e-6, m: 1e-3,
  k: 1e3, K: 1e3, M: 1e6, meg: 1e6, MEG: 1e6, G: 1e9,
};

/** LED forward voltages by colour, used when the sketch names a colour instead of a value. */
export const LED_VF: Record<string, number> = {
  red: 1.8, orange: 2.0, amber: 2.0, yellow: 2.1, green: 2.2,
  blue: 3.2, white: 3.2, uv: 3.4, ir: 1.2,
};

/**
 * Parses a handwritten value into SI base units.
 * Handles "220", "4k7", "4.7k", "10K ohm", "100nF", "9V", "1M2".
 * Returns null when the string carries no number (e.g. "red").
 */
export function parseValue(raw: string | null | undefined): number | null {
  if (raw == null) return null;
  const s = String(raw).trim().replace(/\s+/g, '');
  if (!s) return null;

  // Strip a trailing unit word so "100nF" and "10kohm" both work.
  const stripped = s.replace(/(ohms?|Ω|ohm|F|farads?|H|henr(y|ies)|V|volts?|A|amps?|W|watts?)$/i, '');

  // R-notation / mid-string prefix: 4k7 -> 4700, 1M2 -> 1200000, 2R2 -> 2.2
  const mid = stripped.match(/^(\d+)(p|n|u|µ|μ|m|k|K|M|G|R|r)(\d+)$/);
  if (mid) {
    const [, a, p, b] = mid;
    const mult = p === 'R' || p === 'r' ? 1 : (PREFIX[p] ?? 1);
    return parseFloat(`${a}.${b}`) * mult;
  }

  const m = stripped.match(/^([+-]?\d*\.?\d+)(?:e([+-]?\d+))?(meg|MEG|p|n|u|µ|μ|m|k|K|M|G)?$/);
  if (!m) return null;
  const [, num, exp, prefix] = m;
  let v = parseFloat(num);
  if (!Number.isFinite(v)) return null;
  if (exp) v *= Math.pow(10, parseInt(exp, 10));
  if (prefix) v *= PREFIX[prefix] ?? 1;
  return v;
}

/** Formats an SI value back into engineering notation: 4700 -> "4.7k". */
export function formatValue(v: number, unit: string = ''): string {
  if (!Number.isFinite(v)) return '—';
  const abs = Math.abs(v);
  const table: Array<[number, string]> = [
    [1e9, 'G'], [1e6, 'M'], [1e3, 'k'], [1, ''], [1e-3, 'm'],
    [1e-6, 'µ'], [1e-9, 'n'], [1e-12, 'p'],
  ];
  for (const [scale, suffix] of table) {
    if (abs >= scale) {
      const n = v / scale;
      const s = Math.abs(n) >= 100 ? n.toFixed(0) : Math.abs(n) >= 10 ? n.toFixed(1) : n.toFixed(2);
      // Only trim a fractional tail — "470" must not become "47".
      const trimmed = s.includes('.') ? s.replace(/\.?0+$/, '') : s;
      return `${trimmed}${suffix}${unit}`;
    }
  }
  return `${v.toExponential(1)}${unit}`;
}

/** Short, human engineering strings for the inspector readouts. */
export const fmtA = (a: number) => formatValue(a, 'A');
export const fmtV = (v: number) => `${v.toFixed(2)}V`;
export const fmtW = (w: number) => formatValue(w, 'W');
