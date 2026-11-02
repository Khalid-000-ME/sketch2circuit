/** Shared tail of both routes: canonicalise, solve, judge. */

import { canonicalise } from '../circuit/graph';
import { runRules } from '../circuit/rules';
import { solveDC } from '../circuit/solve';
import type { CircuitGraph, Finding, Net, Simulation } from '../types';

export interface Analysis {
  components: CircuitGraph['components'];
  nets: Net[];
  simulation: Simulation;
  findings: Finding[];
  warnings: string[];
}

export function analyseGraph(graph: CircuitGraph): Analysis {
  const canon = canonicalise(graph);
  const simulation = solveDC(canon);
  const findings = runRules(canon, simulation, canon.floating);
  return {
    components: canon.components,
    nets: canon.nets,
    simulation,
    findings,
    warnings: canon.warnings,
  };
}
