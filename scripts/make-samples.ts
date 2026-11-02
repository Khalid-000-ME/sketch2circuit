/**
 * Generates the three bundled sample sketches as images.
 *
 * These stand in for photographs of real paper so the app is demonstrable with no
 * sketch to hand (FR-1.8). They are drawn with jittered strokes on a ruled-paper
 * background rather than clean vector symbols, so the perception stage is being
 * asked roughly the same question a phone photo asks.
 *
 * Run: npx tsx scripts/make-samples.ts
 */
import sharp from 'sharp';
import { writeFileSync } from 'node:fs';

const W = 1400, H = 1000;

// Deterministic jitter, so regenerating gives byte-identical samples.
let seed = 12345;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const jit = (amp = 3) => (rnd() - 0.5) * 2 * amp;

/** A pencil line from a to b, drawn as a wobbling polyline. */
function line(x1: number, y1: number, x2: number, y2: number, wob = 3): string {
  const len = Math.hypot(x2 - x1, y2 - y1);
  const steps = Math.max(2, Math.round(len / 28));
  const pts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const edge = i === 0 || i === steps ? 0 : 1;
    pts.push(`${(x1 + (x2 - x1) * t + jit(wob) * edge).toFixed(1)},${(y1 + (y2 - y1) * t + jit(wob) * edge).toFixed(1)}`);
  }
  return `<polyline points="${pts.join(' ')}" fill="none"/>`;
}

function poly(points: Array<[number, number]>, wob = 2): string {
  return `<polyline points="${points.map(([x, y]) => `${(x + jit(wob)).toFixed(1)},${(y + jit(wob)).toFixed(1)}`).join(' ')}" fill="none"/>`;
}

/** Zigzag resistor along a horizontal or vertical run. */
function resistor(cx: number, cy: number, horizontal: boolean, len = 150): string {
  const n = 6;
  const amp = 26;
  const pts: Array<[number, number]> = [];
  const half = len / 2;
  pts.push(horizontal ? [cx - half, cy] : [cx, cy - half]);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    const along = -half + len * t;
    const across = (i % 2 === 0 ? -1 : 1) * amp;
    pts.push(horizontal ? [cx + along, cy + across] : [cx + across, cy + along]);
  }
  pts.push(horizontal ? [cx + half, cy] : [cx, cy + half]);
  return poly(pts, 2.5);
}

/** LED: triangle with a cathode bar and two emission arrows. */
function led(cx: number, cy: number, dir: 'right' | 'down'): string {
  const s = 40;
  const tri: Array<[number, number]> = dir === 'right'
    ? [[cx - s, cy - s], [cx - s, cy + s], [cx + s * 0.7, cy], [cx - s, cy - s]]
    : [[cx - s, cy - s], [cx + s, cy - s], [cx, cy + s * 0.7], [cx - s, cy - s]];
  const bar = dir === 'right'
    ? line(cx + s * 0.7, cy - s, cx + s * 0.7, cy + s, 2)
    : line(cx - s, cy + s * 0.7, cx + s, cy + s * 0.7, 2);
  const arrows = dir === 'right'
    ? line(cx - 10, cy - s - 18, cx + 14, cy - s - 42, 2) + line(cx + 14, cy - s - 10, cx + 38, cy - s - 34, 2)
    : line(cx + s + 18, cy - 10, cx + s + 42, cy + 14, 2) + line(cx + s + 10, cy + 14, cx + s + 34, cy + 38, 2);
  return poly(tri, 2) + bar + arrows;
}

/** Battery: alternating long and short plates. `horizontal` describes the wire run. */
function battery(cx: number, cy: number, horizontal: boolean): string {
  const plates = [26, 12, 26, 12];
  let out = '';
  const gap = 18;
  plates.forEach((halfLen, i) => {
    const off = (i - (plates.length - 1) / 2) * gap;
    out += horizontal
      ? line(cx + off, cy - halfLen, cx + off, cy + halfLen, 1.5)
      : line(cx - halfLen, cy + off, cx + halfLen, cy + off, 1.5);
  });
  return out;
}

/** Capacitor: two parallel plates, one curved for an electrolytic. */
function capacitor(cx: number, cy: number, horizontal: boolean): string {
  return horizontal
    ? line(cx - 9, cy - 30, cx - 9, cy + 30, 1.5) + line(cx + 9, cy - 30, cx + 9, cy + 30, 1.5)
    : line(cx - 30, cy - 9, cx + 30, cy - 9, 1.5) + line(cx - 30, cy + 9, cx + 30, cy + 9, 1.5);
}

/** Switch: a gap with a hinged lever. */
function switchSym(cx: number, cy: number): string {
  return `<circle cx="${cx - 34}" cy="${cy}" r="5" fill="#3a4a63"/><circle cx="${cx + 34}" cy="${cy}" r="5" fill="#3a4a63"/>`
    + line(cx - 32, cy, cx + 26, cy - 34, 2);
}

const label = (x: number, y: number, text: string, size = 46, rot = 0) =>
  `<text x="${x}" y="${y}" font-family="Bradley Hand, Segoe Print, Comic Sans MS, cursive" font-size="${size}" fill="#2f3d52" transform="rotate(${rot} ${x} ${y})">${text}</text>`;

function page(body: string): string {
  const rules = Array.from({ length: 24 }, (_, i) =>
    `<line x1="0" y1="${60 + i * 40}" x2="${W}" y2="${60 + i * 40}" stroke="#cfd9e6" stroke-width="1.4"/>`).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <defs>
    <filter id="grain"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="3" result="n"/>
      <feColorMatrix in="n" type="saturate" values="0"/>
      <feComponentTransfer><feFuncA type="linear" slope="0.07"/></feComponentTransfer>
      <feComposite in2="SourceGraphic" operator="over"/></filter>
    <linearGradient id="shade" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff"/><stop offset="55%" stop-color="#fbfaf6"/><stop offset="100%" stop-color="#eceadf"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#shade)"/>
  ${rules}
  <line x1="150" y1="0" x2="150" y2="${H}" stroke="#e9b9bd" stroke-width="2"/>
  <g stroke="#3a4a63" stroke-width="4.2" stroke-linecap="round" stroke-linejoin="round" filter="url(#grain)">
    ${body}
  </g>
</svg>`;
}

// ── Sample 1: battery → resistor → LED, the circuit that works ──────────────
const s1 = page([
  line(300, 300, 700, 300), resistor(820, 300, true), line(940, 300, 1120, 300),
  line(1120, 300, 1120, 620), led(1120, 700, 'down'), line(1120, 790, 1120, 860),
  line(1120, 860, 300, 860), line(300, 860, 300, 620), battery(300, 540, false), line(300, 460, 300, 300),
  label(760, 230, '220Ω'), label(1180, 640, 'red LED', 38), label(180, 560, '9V'),
].join(''));

// ── Sample 2: the hero — an LED straight across the battery ─────────────────
seed = 777;
const s2 = page([
  line(340, 320, 980, 320),
  line(980, 320, 980, 560), led(980, 640, 'down'), line(980, 730, 980, 840),
  line(980, 840, 340, 840), line(340, 840, 340, 640), battery(340, 560, false), line(340, 480, 340, 320),
  label(220, 580, '9V'), label(1050, 600, 'LED', 44),
  label(420, 230, 'will this work?', 40, -3),
].join(''));

// ── Sample 3: a parallel branch with a switch and a capacitor ───────────────
seed = 4242;
const s3 = page([
  line(260, 240, 480, 240), switchSym(540, 240), line(600, 240, 1180, 240),
  // left branch: resistor + LED
  line(700, 240, 700, 360), resistor(700, 470, false, 150), line(700, 580, 700, 700),
  led(700, 760, 'down'), line(700, 850, 700, 900),
  // right branch: resistor
  line(1000, 240, 1000, 420), resistor(1000, 530, false, 150), line(1000, 640, 1000, 900),
  // decoupling cap
  line(1180, 240, 1180, 480), capacitor(1180, 540, false), line(1180, 600, 1180, 900),
  line(260, 900, 1180, 900),
  line(260, 240, 260, 420), battery(260, 500, false), line(260, 580, 260, 900),
  label(560, 480, '470', 40), label(1040, 530, '1k', 40), label(1215, 560, '10µF', 36),
  label(150, 520, '9V'), label(500, 180, 'SW', 36), label(760, 700, 'grn', 34),
].join(''));

const out: Array<[string, string]> = [
  ['sample-series-ok.png', s1],
  ['sample-led-no-resistor.png', s2],
  ['sample-parallel-switch.png', s3],
];
async function main() {
  for (const [name, svg] of out) {
    const buf = await sharp(Buffer.from(svg)).png({ quality: 92 }).toBuffer();
    writeFileSync(`public/samples/${name}`, buf);
    console.log(`wrote public/samples/${name} (${(buf.length / 1024).toFixed(0)}KB)`);
  }
}
void main();
