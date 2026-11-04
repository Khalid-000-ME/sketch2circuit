/** Shared tail of both routes: canonicalise, apply what is written, solve, judge. */

import { canonicalise } from '../circuit/graph';
import { runRules } from '../circuit/rules';
import { solveDC } from '../circuit/solve';
import { applySpec, type RawSpec } from '../circuit/spec';
import type { CircuitGraph, Finding, Net, Simulation, SpecConnection } from '../types';

export interface Analysis {
  components: CircuitGraph['components'];
  nets: Net[];
  simulation: Simulation;
  findings: Finding[];
  warnings: string[];
  /** Connections written on the page, resolved to pins. Empty when there were none. */
  spec: SpecConnection[];
}

/**
 * `specRaw` is what was written on the page. It is applied before the circuit is
 * solved, so the findings describe the circuit the writing says and not only the
 * one that was drawn; where the two disagree the drawing is kept and the
 * disagreement is reported (see `applySpec`).
 */
export function analyseGraph(graph: CircuitGraph, specRaw: RawSpec[] = []): Analysis {
  const first = canonicalise(graph);

  let canon = first;
  let spec: SpecConnection[] = [];
  const specWarnings: string[] = [];
  if (specRaw.length > 0) {
    const applied = applySpec(first.components, first.nets, specRaw);
    spec = applied.items;
    specWarnings.push(...applied.warnings);
    // Canonicalise again: applying a line can merge nets, and the solver and the
    // floating-pin check both want the merged picture.
    canon = canonicalise({ components: first.components, nets: applied.nets });
  }

  const simulation = solveDC(canon);
  const findings = runRules(canon, simulation, canon.floating);
  return {
    components: canon.components,
    nets: canon.nets,
    simulation,
    findings,
    warnings: [...first.warnings, ...specWarnings],
    spec,
  };
}

/**
 * How sure connectivity is, once what was written has been taken into account.
 *
 * The model rates connectivity by how clearly it could follow drawn wires, so a
 * page that is only a table scores badly for having none, when the table is about
 * the most explicit evidence there is. Pins that a written line accounts for are
 * as trustworthy as the reading of the handwriting, so they are scored by how well
 * the values were read; pins that only a drawing accounts for keep the model's score.
 */
export function withWrittenEvidence(
  confidence: { components: number; connectivity: number; values: number },
  warnings: string[],
  spec: SpecConnection[],
  nets: Net[],
) {
  if (spec.length === 0) return { confidence, warnings };
  const written = new Set(spec.flatMap((s) => [s.a, s.b]));
  const pins = nets.flatMap((n) => n.pins);
  if (pins.length === 0) return { confidence, warnings };

  const share = pins.filter((p) => written.has(p)).length / pins.length;
  const connectivity = Math.max(
    confidence.connectivity,
    share * Math.min(0.95, confidence.values) + (1 - share) * confidence.connectivity,
  );

  // The warning was written against the old number, so it is written again.
  const kept = warnings.filter((w) => !w.startsWith('Connectivity confidence is'));
  if (connectivity < 0.85) {
    kept.push(`Connectivity confidence is ${connectivity.toFixed(2)} — below 0.85. Verify the connections before trusting the findings.`);
  }
  return { confidence: { ...confidence, connectivity }, warnings: kept };
}
