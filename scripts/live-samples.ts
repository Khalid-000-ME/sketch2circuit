/** Runs every bundled sample through the live /api/analyze and scores the result. */
import { readFileSync } from 'node:fs';
import { ALL_FIXTURES } from '../src/fixtures/circuits';
import { canonicalise } from '../src/lib/circuit/graph';
import type { AnalyzeResponse, CircuitGraph } from '../src/lib/types';

const BASE = process.env.BASE ?? 'http://localhost:3111';

/** Ground truth, as net-sets of pin refs, canonicalised the same way. */
function truthNets(graph: CircuitGraph): Set<string> {
  return new Set(canonicalise(graph).nets.map((n) => [...n.pins].sort().join('+')));
}

const CASES: Array<{ file: string; truth: CircuitGraph }> = [
  { file: 'sample-series-ok', truth: ALL_FIXTURES.SERIES_OK },
  { file: 'sample-led-no-resistor', truth: ALL_FIXTURES.LED_NO_RESISTOR },
  { file: 'sample-parallel-switch', truth: ALL_FIXTURES.PARALLEL_SWITCH },
];

async function main() {
  let compHits = 0, compTotal = 0, netExact = 0;
  for (const { file, truth } of CASES) {
    const buf = readFileSync(`public/samples/${file}.png`);
    const form = new FormData();
    form.append('image', new Blob([new Uint8Array(buf)], { type: 'image/png' }), `${file}.png`);
    const t0 = Date.now();
    const res = await fetch(`${BASE}/api/analyze`, { method: 'POST', body: form });
    const ms = Date.now() - t0;
    const body = (await res.json()) as AnalyzeResponse & { error?: string };
    console.log(`\n=== ${file} (${res.status}, ${(ms / 1000).toFixed(1)}s) ===`);
    if (body.error) { console.log('  ERROR:', body.error); continue; }

    // Component scoring: type multiset against truth.
    const got = body.components.map((c) => c.type).sort();
    const want = truth.components.map((c) => c.type).sort();
    const pool = [...got];
    let hit = 0;
    for (const t of want) {
      const i = pool.indexOf(t);
      if (i >= 0) { pool.splice(i, 1); hit++; }
    }
    compHits += hit; compTotal += want.length;
    console.log(`  components ${hit}/${want.length}: got [${got.join(', ')}]`);
    console.log(`  values: ${body.components.map((c) => `${c.id}=${c.value ?? '-'}`).join(' ')}`);

    const gotNets = new Set(body.nets.map((n) => [...n.pins].sort().join('+')));
    const wantNets = truthNets(truth);
    const same = gotNets.size === wantNets.size && [...wantNets].every((n) => gotNets.has(n));
    if (same) netExact++;
    console.log(`  nets ${same ? 'EXACT MATCH' : 'MISMATCH'} (traced=${body.segmentation?.wire_trace_used})`);
    if (!same) {
      console.log(`    want: ${[...wantNets].join(' | ')}`);
      console.log(`    got:  ${[...gotNets].join(' | ')}`);
    }
    console.log(`  confidence: C=${body.confidence.components.toFixed(2)} N=${body.confidence.connectivity.toFixed(2)} V=${body.confidence.values.toFixed(2)}`);
    console.log(`  trace coverage=${body.timings?.trace_coverage ?? '-'}%  sim=${body.simulation.status}`);
    for (const f of body.findings) console.log(`  [${f.severity}] ${f.rule}`);
  }
  console.log(`\n── component type F1-ish: ${compHits}/${compTotal} (${(compHits / compTotal * 100).toFixed(0)}%)`);
  console.log(`── exact netlist match: ${netExact}/${CASES.length}`);
}
void main();
