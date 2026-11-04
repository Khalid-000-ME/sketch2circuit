/**
 * The three bundled sketches a judge can run without having drawn anything
 * (FR-1.8), and the cached results that keep them working if the Model API is
 * unreachable mid-demo (§11, "Meta Model API rate limits or outages").
 *
 * The cached result is computed here from the same solver and rule suite the live
 * path uses, so it can never drift from the real output — only the perception
 * stage is pre-supplied.
 */

import { analyseGraph } from '../lib/pipeline/analyse';
import type { RawSpec } from '../lib/circuit/spec';
import type { AnalyzeResponse, CircuitGraph, Confidence } from '../lib/types';
import { ARDUINO_BLINK_OK, LED_NO_RESISTOR, PARALLEL_SWITCH, PI_LED_DIRECT, SERIES_OK } from './circuits';

export interface Sample {
  id: string;
  title: string;
  description: string;
  image: string;
  difficulty: 'easy' | 'medium' | 'hard';
  graph: CircuitGraph;
  /** What the sketch states in writing, for a sketch that has any. */
  spec?: RawSpec[];
  confidence: Confidence;
}

export const SAMPLES: Sample[] = [
  {
    id: 'series-ok',
    title: 'A circuit that works',
    description: '9V battery, 220Ω resistor, red LED in series.',
    image: '/samples/sample-series-ok.png',
    difficulty: 'easy',
    graph: { ...SERIES_OK, components: SERIES_OK.components.map((c) => (c.id === 'R1' ? { ...c, value: '220' } : c)) },
    confidence: { components: 0.96, connectivity: 0.93, values: 0.91 },
  },
  {
    id: 'led-no-resistor',
    title: 'The one that burns out',
    description: 'A red LED straight across a 9V battery, with no current limiting.',
    image: '/samples/sample-led-no-resistor.png',
    difficulty: 'easy',
    graph: LED_NO_RESISTOR,
    confidence: { components: 0.95, connectivity: 0.94, values: 0.88 },
  },
  {
    id: 'parallel-switch',
    title: 'Two branches and a switch',
    description: 'A switched supply feeding an LED branch and a 1k resistor, with a 10µF decoupling capacitor.',
    image: '/samples/sample-parallel-switch.png',
    difficulty: 'medium',
    graph: PARALLEL_SWITCH,
    confidence: { components: 0.91, connectivity: 0.84, values: 0.86 },
  },
  {
    id: 'arduino-blink',
    title: 'Arduino blink',
    description: 'Pin D13 drives a red LED through a 220Ω resistor.',
    image: '/samples/sample-arduino-blink.png',
    difficulty: 'medium',
    graph: ARDUINO_BLINK_OK,
    confidence: { components: 0.95, connectivity: 0.9, values: 0.92 },
  },
  {
    id: 'pi-led-direct',
    title: 'The Pi pin that burns',
    description: 'A Raspberry Pi GPIO pin driving an LED with nothing in between.',
    image: '/samples/sample-pi-led-direct.png',
    difficulty: 'medium',
    graph: PI_LED_DIRECT,
    confidence: { components: 0.95, connectivity: 0.88, values: 0.95 },
  },
  {
    id: 'wiring-table',
    title: 'A wiring table, no drawing',
    description: 'Only a written list of which pin goes where. No wires drawn at all.',
    image: '/samples/sample-wiring-table.png',
    difficulty: 'hard',
    // The parts, and nothing joining them: every connection comes from the writing.
    graph: { components: ARDUINO_BLINK_OK.components, nets: [] },
    spec: [
      { from: 'U1.D13', to: 'R1', text: 'D13  ->  R1' },
      { from: 'R1', to: 'D1.anode', text: 'R1  ->  LED +' },
      { from: 'D1.cathode', to: 'U1.GND', text: 'LED -  ->  GND' },
    ],
    confidence: { components: 0.92, connectivity: 0.9, values: 0.9 },
  },
];

const cache = new Map<string, AnalyzeResponse>();

/** The cached analysis for a bundled sample, or null if the id is not one. */
export function prebakedFor(sampleId: string | null | undefined): AnalyzeResponse | null {
  if (!sampleId) return null;
  const cached = cache.get(sampleId);
  if (cached) return cached;
  const sample = SAMPLES.find((s) => s.id === sampleId);
  if (!sample) return null;

  const analysis = analyseGraph(sample.graph, sample.spec);
  const response: AnalyzeResponse = {
    circuit_id: `c_sample_${sample.id}`,
    ...(analysis.spec.length ? { spec: analysis.spec } : {}),
    cached: true,
    components: analysis.components,
    nets: analysis.nets,
    confidence: sample.confidence,
    simulation: analysis.simulation,
    findings: analysis.findings,
    warnings: analysis.warnings,
  };
  cache.set(sampleId, response);
  return response;
}
