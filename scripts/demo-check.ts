/**
 * Every bundled sample, analysed live, the way a demo will.
 *
 * Checks three things per sample: that the answer is not a cached stand-in, that
 * the netlist matches the hand-built truth for that sketch, and how long it took.
 * Run: npx tsx scripts/demo-check.ts   (server on :3111, MODEL_API_KEY set)
 */
import { readFileSync } from 'node:fs';
import { SAMPLES } from '../src/fixtures/samples';
import { canonicalise } from '../src/lib/circuit/graph';
import type { AnalyzeResponse, CircuitGraph } from '../src/lib/types';

const BASE = process.env.BASE ?? 'http://localhost:3111';
const nets = (g: CircuitGraph) => new Set(canonicalise(g).nets.map((n) => [...n.pins].sort().join('+')));

async function main() {
  let failed = 0;
  for (const s of SAMPLES) {
    const file = s.image.replace(/^\//, '');
    const buf = readFileSync(`public/${file}`);
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(buf)], { type: 'image/png' }), 'sketch.png');
    form.append('sample', s.id);
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/analyze`, { method: 'POST', body: form });
    const took = ((Date.now() - t0) / 1000).toFixed(0);
    if (!res.ok) {
      failed++;
      console.log(`FAIL ${s.id} — HTTP ${res.status} after ${took}s`);
      continue;
    }
    const body = (await res.json()) as AnalyzeResponse;
    const truth = nets(s.graph);
    const got = new Set(body.nets.map((n) => [...n.pins].sort().join('+')));
    const exact = truth.size === got.size && [...truth].every((n) => got.has(n));
    const problems: string[] = [];
    if (body.cached) problems.push('served from cache');
    if (!exact) problems.push(`netlist differs — expected ${[...truth].join(' | ')}, got ${[...got].join(' | ')}`);
    if (problems.length) failed++;
    console.log(`${problems.length ? 'FAIL' : 'ok  '} ${s.id.padEnd(18)} ${took}s  ${body.components.length} parts${problems.length ? '\n     ' + problems.join('\n     ') : ''}`);
  }
  console.log(failed ? `\n${failed} of ${SAMPLES.length} samples would not demo cleanly` : `\nall ${SAMPLES.length} samples analysed live and matched`);
  process.exit(failed ? 1 : 0);
}
void main();
