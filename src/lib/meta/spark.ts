/**
 * Muse Spark calls: the reasoning half of the perception stage.
 *
 * Two distinct jobs, deliberately kept apart:
 *
 *   1. `readSketch` looks at the whole page once and answers the questions that
 *      need global context — what symbols are here, roughly where, how are they
 *      wired, and which noun phrases should SAM be asked to segment.
 *   2. `readComponentCrop` looks at one SAM-isolated symbol and answers only the
 *      questions that need detail — the handwritten value, the unit, the polarity.
 *
 * Splitting them is what makes the per-mask crop worth doing: the second call
 * sees a label filling its frame instead of a smudge in the corner of a photo.
 */

import { SPARK_MODEL, postJson, type MetaRequestOptions } from './client';

type Json = Record<string, unknown>;

interface ChatChoice { message?: { content?: string | null } }
interface ChatResponse { choices?: ChatChoice[] }

/** Pulls the first JSON object out of a reply, tolerating fences or stray prose. */
export function extractJson<T>(text: string): T | null {
  const trimmed = text.trim();
  const candidates: string[] = [];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) candidates.push(fenced[1]);
  candidates.push(trimmed);
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));
  for (const c of candidates) {
    try { return JSON.parse(c) as T; } catch { /* try the next shape */ }
  }
  return null;
}

async function sparkJson<T>(
  system: string,
  content: Array<Json>,
  schema: { name: string; schema: Json },
  opts: MetaRequestOptions & { effort?: 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' } = {},
): Promise<T | null> {
  const body: Json = {
    model: SPARK_MODEL,
    // Pinned, for what it is worth. Muse Spark still varies run to run at zero —
    // measured, its bounding boxes move by a few percent — because the sampling
    // that matters happens in the reasoning trace. It reduces the spread rather
    // than removing it, and costs nothing.
    temperature: 0,
    messages: [
      { role: 'developer', content: system },
      { role: 'user', content },
    ],
    response_format: {
      type: 'json_schema',
      json_schema: { name: schema.name, schema: schema.schema, strict: false },
    },
  };
  if (opts.effort) body.reasoning_effort = opts.effort;
  // The page read is a long prompt asking for a lot of structure, and Muse Spark
  // reasons for as long as it needs. Measured against the live API it ranges from
  // about 20s to past a minute for the same image, so the ceiling is generous:
  // a slow answer is worth far more than a timeout.
  const res = await postJson<ChatResponse>('/chat/completions', body, { timeoutMs: 95_000, ...opts });
  const text = res.choices?.[0]?.message?.content ?? '';
  return text ? extractJson<T>(text) : null;
}

const imagePart = (dataUrl: string): Json => ({ type: 'image_url', image_url: { url: dataUrl } });
const textPart = (text: string): Json => ({ type: 'text', text });

// ───────────────────────────────────────────────────────── whole-sketch pass

export interface SparkComponent {
  id: string;
  type: string;
  value: string | null;
  unit: string | null;
  orientation: string | null;
  /** [x, y, w, h] in thousandths of the image, origin top-left. */
  bbox_permille: [number, number, number, number] | null;
  confidence: number;
}

export interface SparkPin { component_id: string; pin: string }

export interface SparkReading {
  components: SparkComponent[];
  /** The model's own first guess at connectivity; used when the mask walk fails. */
  nets: Array<{ pins: string[]; is_ground?: boolean }>;
  /** Noun phrases to hand to SAM, one request each. */
  sam_concepts: string[];
  confidence: { components: number; connectivity: number; values: number };
  notes: string[];
  is_circuit: boolean;
}

/** The only component types the rest of the app can act on. */
const COMPONENT_TYPES = [
  'resistor', 'led', 'battery', 'ground', 'junction', 'capacitor',
  'capacitor_electrolytic', 'switch', 'diode', 'potentiometer', 'transistor',
  'ic', 'inductor', 'crystal', 'header', 'buzzer', 'motor', 'unknown',
] as const;

const SKETCH_SCHEMA = {
  name: 'circuit_reading',
  schema: {
    type: 'object',
    properties: {
      is_circuit: { type: 'boolean' },
      components: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'string' },
            type: { type: 'string', enum: COMPONENT_TYPES },
            value: { type: ['string', 'null'] },
            unit: { type: ['string', 'null'] },
            orientation: { type: ['string', 'null'] },
            bbox_permille: { type: ['array', 'null'], items: { type: 'number' }, minItems: 4, maxItems: 4 },
            confidence: { type: 'number' },
          },
          required: ['id', 'type'],
        },
      },
      nets: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            pins: { type: 'array', items: { type: 'string' } },
            is_ground: { type: 'boolean' },
          },
          required: ['pins'],
        },
      },
      sam_concepts: { type: 'array', items: { type: 'string' } },
      confidence: {
        type: 'object',
        properties: {
          components: { type: 'number' }, connectivity: { type: 'number' }, values: { type: 'number' },
        },
      },
      notes: { type: 'array', items: { type: 'string' } },
    },
    required: ['is_circuit', 'components', 'nets', 'sam_concepts', 'confidence'],
  },
} as const;

const SKETCH_SYSTEM = `You read photographs of hand-drawn electronic circuit diagrams and return structured data about them. You are the perception stage of a tool that then simulates the circuit and tells a beginner what is wrong with it, so accuracy about topology matters far more than fluency.

Rules:
- Identify every component symbol you can see. Use these type names only: resistor, led, battery, ground, junction, capacitor, capacitor_electrolytic, switch, diode, potentiometer, transistor, ic, inductor, crystal, header, buzzer, motor. If a symbol is unmistakably electronic but matches none of these, use "unknown".
- Give each component a conventional reference id: R1, R2 for resistors; D1 for LEDs and diodes; B1 for batteries and supplies; C1 for capacitors; SW1 for switches; Q1 for transistors; U1 for ICs; L1 for inductors; RV1 for potentiometers; M1 for motors; LS1 for buzzers. Number from 1 in reading order. Never reuse an id.
- "value" is exactly the text written on the sketch, with no unit and no interpretation: "220", "4.7k", "9". For an LED with no number, use the colour word if one is written or drawn, otherwise null. If nothing is written, use null — never invent a plausible value.
- "unit" is one of ohm, V, F, H, A, Hz, or null.
- "orientation" matters for led, diode, battery and electrolytic capacitor. Describe which way the symbol points in the image: anode_left, anode_right, anode_up, anode_down, pos_left, pos_right, pos_up, pos_down. Null when it does not matter.
- "bbox_permille" is [x, y, width, height] in thousandths of the image width and height, origin at the top-left. Be tight around the symbol itself, not its label.
- "nets" describes which leads are electrically joined, following the drawn wires. Each pin reference is "<component_id>.<pin>". Pin names: resistor a/b; led and diode anode/cathode; battery pos/neg; capacitor a/b; electrolytic pos/neg; switch a/b; potentiometer a/b/wiper; transistor base/collector/emitter; buzzer pos/neg; motor a/b; ground gnd; inductor a/b. Every lead that touches a wire must appear in exactly one net. Mark the net that a ground symbol or the battery's negative terminal sits on with is_ground.
- Wires that cross without a solder dot are NOT connected. A dot, or a clear T-junction, means they are.
- "sam_concepts" lists short noun phrases for a segmentation model to find in this image, one concept per distinct thing worth isolating. Always include a phrase for the drawn connecting lines, such as "drawn wire line". Add one phrase per component kind present, phrased as it appears on paper: "zigzag resistor symbol", "LED triangle symbol", "battery symbol", "handwritten value label". Six concepts at most.
- "confidence" is your own honest assessment, 0 to 1, separately for component identification, connectivity and value reading. Be conservative: if two leads are ambiguous, connectivity is below 0.7.
- "notes" is for anything a human should double-check, in plain language, one sentence each.
- If the image contains no circuit diagram at all, set is_circuit to false and return empty arrays.

Return JSON only.`;

export async function readSketch(imageDataUrl: string, opts: MetaRequestOptions = {}): Promise<SparkReading | null> {
  const raw = await sparkJson<SparkReading>(
    SKETCH_SYSTEM,
    [
      textPart('Read this hand-drawn circuit. Identify every component, read every handwritten value, and recover the connectivity by following the drawn wires.'),
      imagePart(imageDataUrl),
    ],
    SKETCH_SCHEMA as unknown as { name: string; schema: Json },
    // Measured: 'high' is required here. At 'medium' the same sketches come back
    // with duplicated components, no values at all and unusable connectivity —
    // and not reliably faster, since a confused read reasons for longer.
    { effort: 'high', ...opts },
  );
  if (!raw) return null;
  return {
    is_circuit: raw.is_circuit !== false,
    components: Array.isArray(raw.components) ? raw.components : [],
    nets: Array.isArray(raw.nets) ? raw.nets : [],
    sam_concepts: Array.isArray(raw.sam_concepts) ? raw.sam_concepts : [],
    confidence: {
      components: Number(raw.confidence?.components ?? 0.5),
      connectivity: Number(raw.confidence?.connectivity ?? 0.5),
      values: Number(raw.confidence?.values ?? 0.5),
    },
    notes: Array.isArray(raw.notes) ? raw.notes : [],
  };
}

// ───────────────────────────────────────────────────────── per-crop pass

export interface CropReading {
  type: string | null;
  value: string | null;
  unit: string | null;
  orientation: string | null;
  confidence: number;
  value_confidence: number;
  note: string | null;
}

const CROP_SCHEMA = {
  name: 'component_crop',
  schema: {
    type: 'object',
    properties: {
      type: { type: ['string', 'null'], enum: [...COMPONENT_TYPES, null] },
      value: { type: ['string', 'null'] },
      unit: { type: ['string', 'null'] },
      orientation: { type: ['string', 'null'] },
      confidence: { type: 'number' },
      value_confidence: { type: 'number' },
      note: { type: ['string', 'null'] },
    },
    required: ['type', 'value', 'unit', 'confidence', 'value_confidence'],
  },
} as const;

const CROP_SYSTEM = `You are shown a close crop of ONE component symbol from a hand-drawn circuit diagram, isolated by a segmentation model, together with its immediate surroundings so any handwritten label is visible.

Report only what is in this crop:
- "type": the component type, from resistor, led, battery, ground, junction, capacitor, capacitor_electrolytic, switch, diode, potentiometer, transistor, ic, inductor, crystal, header, buzzer, motor, unknown.
- "value": the handwritten value as written, digits and multiplier only, no unit: "220", "4k7", "9", "100n". For an LED, a colour word if one is given. null if nothing is written in this crop.
- "unit": ohm, V, F, H, A, Hz or null.
- "orientation": for led, diode, battery and electrolytic capacitor, which way it points — anode_left, anode_right, anode_up, anode_down, pos_left, pos_right, pos_up, pos_down. Null otherwise.
- "confidence" and "value_confidence": 0 to 1, honest. If the handwriting is ambiguous between two readings, say so in "note" and give a low value_confidence.
- Never guess a value that is not written. A missing value is a useful answer; an invented one is not.

Return JSON only.`;

export async function readComponentCrop(
  cropDataUrl: string,
  hint: { type: string; id: string },
  opts: MetaRequestOptions = {},
): Promise<CropReading | null> {
  const raw = await sparkJson<CropReading>(
    CROP_SYSTEM,
    [
      textPart(`This crop was identified as ${hint.id}, a ${hint.type.replace(/_/g, ' ')}. Confirm the type and read its handwritten value and orientation. Correct the type if it is clearly wrong.`),
      imagePart(cropDataUrl),
    ],
    CROP_SCHEMA as unknown as { name: string; schema: Json },
    { effort: 'minimal', ...opts },
  );
  if (!raw) return null;
  return {
    type: raw.type ?? null,
    value: raw.value ?? null,
    unit: raw.unit ?? null,
    orientation: raw.orientation ?? null,
    confidence: Number.isFinite(raw.confidence) ? raw.confidence : 0.5,
    value_confidence: Number.isFinite(raw.value_confidence) ? raw.value_confidence : 0.5,
    note: raw.note ?? null,
  };
}
