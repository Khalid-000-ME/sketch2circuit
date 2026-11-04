/** Core domain types. Shared by the vision pipeline, the solver and the renderer. */

export type ComponentType =
  // Tier 1
  | 'resistor' | 'led' | 'battery' | 'ground' | 'junction'
  // Tier 2
  | 'capacitor' | 'capacitor_electrolytic' | 'switch' | 'diode' | 'potentiometer'
  // Tier 3
  | 'transistor' | 'ic' | 'inductor' | 'crystal' | 'header' | 'buzzer' | 'motor'
  | 'unknown';

export const PINS: Record<ComponentType, readonly string[]> = {
  resistor: ['a', 'b'],
  led: ['anode', 'cathode'],
  battery: ['pos', 'neg'],
  ground: ['gnd'],
  junction: ['a'],
  capacitor: ['a', 'b'],
  capacitor_electrolytic: ['pos', 'neg'],
  switch: ['a', 'b'],
  diode: ['anode', 'cathode'],
  potentiometer: ['a', 'b', 'wiper'],
  transistor: ['base', 'collector', 'emitter'],
  ic: ['1', '2', '3', '4', '5', '6', '7', '8'],
  inductor: ['a', 'b'],
  crystal: ['a', 'b'],
  header: ['1', '2'],
  buzzer: ['pos', 'neg'],
  motor: ['a', 'b'],
  unknown: ['a', 'b'],
};

/** Units as the model is allowed to report them; normalised to SI by `normaliseValue`. */
export type Unit = 'ohm' | 'V' | 'F' | 'H' | 'A' | 'Hz' | 'W' | null;

export interface CircuitComponent {
  id: string;
  type: ComponentType;
  /** Raw value string as read from the sketch, e.g. "220", "9", "red", "10k". */
  value: string | null;
  unit: Unit;
  /** Orientation hint from vision, e.g. "anode_left". Null when it does not matter. */
  orientation: string | null;
  /** [x, y, w, h] in source-image pixels. */
  bbox: [number, number, number, number] | null;
  /** Index into the SAM mask set this component came from. */
  mask_id: number | null;
  confidence: number;
  pins: string[];
  /** Set when the user corrected or edited this component in the inspector. */
  user_edited?: boolean;
}

export interface Net {
  id: string;
  /** Pin references of the form "<componentId>.<pin>". */
  pins: string[];
  is_ground?: boolean;
  /** How the net was recovered: the deterministic mask walk, or the model. */
  source?: 'mask_trace' | 'model' | 'user';
  confidence?: number;
}

export interface ComponentResult {
  current_a: number;
  voltage_v: number;
  power_w: number;
}

export interface Simulation {
  status: 'ok' | 'unsimulatable' | 'no_source';
  node_voltages: Record<string, number>;
  component_results: Record<string, ComponentResult>;
  /** Present when status !== 'ok'. */
  reason?: string;
  iterations?: number;
}

export type Severity = 'error' | 'warning' | 'info';

export interface Finding {
  id: string;
  severity: Severity;
  component_id: string | null;
  rule: string;
  message: string;
  fix: string;
}

export interface Confidence {
  components: number;
  connectivity: number;
  values: number;
}

export interface CircuitGraph {
  components: CircuitComponent[];
  nets: Net[];
}

export interface AnalyzeResponse extends CircuitGraph {
  circuit_id: string;
  /**
   * True when this is a stored result for a bundled sample rather than a fresh
   * analysis of the image. The interface says so, because a cached circuit that
   * looks live is a result the person cannot judge correctly.
   */
  cached?: boolean;
  confidence: Confidence;
  simulation: Simulation;
  findings: Finding[];
  warnings: string[];
  /** Debug/demo payload: what SAM actually segmented. Drives the overlay in the UI. */
  segmentation?: {
    concept_counts: Record<string, number>;
    masks: Array<{
      mask_id: number;
      concept: string;
      bbox: [number, number, number, number];
      confidence: number | null;
      svg_path?: string;
    }>;
    image_width: number;
    image_height: number;
    wire_trace_used: boolean;
  };
  timings?: Record<string, number>;
}

export interface SimulateResponse extends CircuitGraph {
  simulation: Simulation;
  findings: Finding[];
  warnings: string[];
}

export class HttpError extends Error {
  constructor(public status: number, public userMessage: string, message?: string) {
    super(message ?? userMessage);
  }
}
