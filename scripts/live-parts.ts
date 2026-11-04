/**
 * Describes real parts to the live model and reports whether each comes back
 * verified by the solver. Uses MODEL_API_KEY from .env.local.
 *
 * Run: npx tsx scripts/live-parts.ts "a 5V relay" "a 9.1V zener" ...
 */
import { readFileSync } from 'node:fs';
try {
  for (const line of readFileSync('.env.local', 'utf8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* the key may already be in the environment */ }

async function main() {
  const { designPart } = await import('../src/lib/meta/part');
  const wanted = process.argv.slice(2);
  for (const description of wanted) {
    const t0 = Date.now();
    try {
      const r = await designPart(description);
      console.log(`\n"${description}" — ${((Date.now() - t0) / 1000).toFixed(0)}s, ${r.attempts} attempt(s), ${r.verified ? 'VERIFIED' : r.buildable ? 'NOT verified' : 'not buildable'}`);
      if (r.def) console.log(`  ${r.def.name}: pins ${r.def.pins.map((p) => p.name).join(', ')}; ${r.def.elements.map((e) => e.kind).join(', ')}; ${r.def.fidelity}`);
      for (const c of r.results) console.log(`  ${c.pass ? '✓' : '✗'} ${c.say}${c.pass ? '' : '\n      ' + c.detail.join('\n      ')}`);
      if (!r.buildable) console.log(`  reason: ${r.reason}`);
      if (r.problems.length) console.log(`  problems: ${r.problems.join(' | ')}`);
    } catch (e) {
      console.log(`\n"${description}" — error: ${(e as Error).message}`);
    }
  }
}
void main();
