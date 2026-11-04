/** Regenerates scripts/cases/fixture-*.json from the engine fixtures. */
import { writeFileSync } from 'node:fs';
import { ALL_FIXTURES } from '../src/fixtures/circuits';
import { analyseGraph } from '../src/lib/pipeline/analyse';

for (const [name, graph] of Object.entries(ALL_FIXTURES)) {
  const a = analyseGraph(graph);
  writeFileSync(`scripts/cases/fixture-${name.toLowerCase()}.json`, JSON.stringify({ components: a.components, nets: a.nets }, null, 1));
}
console.log(`wrote ${Object.keys(ALL_FIXTURES).length} fixture cases`);
