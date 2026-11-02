/** Smoke test for the solver + rules. Run: npx tsx scripts/engine-test.ts */
import { ALL_FIXTURES } from '../src/fixtures/circuits';
import { canonicalise } from '../src/lib/circuit/graph';
import { solveDC } from '../src/lib/circuit/solve';
import { runRules } from '../src/lib/circuit/rules';

const fails = 0;
for (const [name, fixture] of Object.entries(ALL_FIXTURES)) {
  const canon = canonicalise(fixture);
  const sim = solveDC(canon);
  const findings = runRules(canon, sim, canon.floating);
  console.log(`\n=== ${name} — sim:${sim.status}${sim.reason ? ` (${sim.reason})` : ''} iters:${sim.iterations ?? '-'}`);
  console.log('   nets:', canon.nets.map((n) => `${n.id}[${n.pins.join(',')}]${n.is_ground ? '*' : ''}`).join(' '));
  console.log('   V:', Object.entries(sim.node_voltages).map(([k, v]) => `${k}=${v.toFixed(3)}`).join(' '));
  for (const [id, r] of Object.entries(sim.component_results)) {
    console.log(`   ${id}: I=${(r.current_a * 1000).toFixed(2)}mA V=${r.voltage_v.toFixed(3)} P=${r.power_w.toFixed(4)}W`);
  }
  if (canon.floating.length) console.log('   floating:', canon.floating.join(','));
  for (const f of findings) console.log(`   [${f.severity}] ${f.rule}: ${f.message}  FIX: ${f.fix}`);
  if (canon.warnings.length) console.log('   warn:', canon.warnings.join(' | '));
}
process.exit(fails);
