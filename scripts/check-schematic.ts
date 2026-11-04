/**
 * Geometric lint for a drawn schematic. Reads a saved analysis, arranges and
 * routes it exactly as the app does, and reports anything that would mislead a
 * reader. Run: npx tsx scripts/check-schematic.ts [case.json ...]
 */
import { readFileSync, readdirSync } from 'node:fs';
import { arrangeSchematic } from '../src/schematic/arrange';
import { layoutSchematic } from '../src/schematic/layout2d';
import { drawingCost, findConflicts } from '../src/schematic/lint';
import { routeSchematic } from '../src/schematic/route2d';

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync('scripts/cases').filter((f) => f.endsWith('.json')).map((f) => `scripts/cases/${f}`);

let failed = 0;
for (const file of files) {
  const d = JSON.parse(readFileSync(file, 'utf8'));
  const raw = layoutSchematic(d.components, d.nets);
  const rawRoutes = routeSchematic(d.components, d.nets, raw);
  const before = findConflicts(d.components, raw, rawRoutes);
  const arranged = arrangeSchematic(d.components, d.nets);
  const arrangedRoutes = routeSchematic(d.components, d.nets, arranged);
  const after = findConflicts(d.components, arranged, arrangedRoutes);
  console.log(`${file}\n  conflicts ${before.length} -> ${after.length}   cost ${drawingCost(rawRoutes).toFixed(0)} -> ${drawingCost(arrangedRoutes).toFixed(0)}   hubs: ${arranged.outwardHubs ? 'outward' : 'median'}`);
  for (const p of after) console.log('   -', p);
  if (after.length) failed++;
}
process.exit(failed ? 1 : 0);
