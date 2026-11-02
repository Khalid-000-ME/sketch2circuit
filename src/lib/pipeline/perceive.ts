/**
 * The perception stage: SAM 3.1 and Muse Spark composed into one circuit graph.
 *
 * The order matters and is the whole argument for using both models rather than
 * one:
 *
 *   1. Spark reads the page once and says what is there, roughly where, and which
 *      noun phrases are worth segmenting. A segmentation model cannot do this —
 *      it needs to be told what to look for.
 *   2. SAM segments each of those concepts, returning a tight box and a mask per
 *      match. A language model cannot do this — it does not produce pixels.
 *   3. SAM's boxes replace Spark's estimates, because a mask boundary is exact and
 *      a described box is not. Pin geometry is computed from them.
 *   4. SAM's wire mask is walked deterministically to recover connectivity
 *      (`trace.ts`). This is the stage that decides whether the product works.
 *   5. Each component is cropped from its own mask and sent back to Spark alone,
 *      so a handwritten "220" is read from a frame it fills rather than from a
 *      corner of a photograph.
 *
 * Remove either model and a numbered step above has no replacement.
 */

import sharp from 'sharp';
import type { CircuitComponent, CircuitGraph, Confidence, Net } from '../types';
import { HttpError, PINS } from '../types';
import { normaliseType } from '../circuit/graph';
import { readComponentCrop, readSketch } from '../meta/spark';
import { segmentConcepts, type SamMask } from '../meta/sam';
import { markGround, traceNets, type TraceResult } from './trace';

/** Below this pin coverage the mask walk is not trusted and Spark's netlist is used. */
const TRACE_COVERAGE_MIN = 0.75;
/** Concurrent per-crop Spark calls. */
const CROP_CONCURRENCY = 4;
/** Padding around a component's mask box when cropping, as a fraction of its size. */
const CROP_PAD = 0.55;

export interface PerceiveResult extends CircuitGraph {
  confidence: Confidence;
  warnings: string[];
  notes: string[];
  segmentation: {
    concept_counts: Record<string, number>;
    masks: Array<{
      mask_id: number; concept: string; bbox: [number, number, number, number];
      confidence: number | null; svg_path?: string;
    }>;
    image_width: number;
    image_height: number;
    wire_trace_used: boolean;
  };
  timings: Record<string, number>;
}

const isWireConcept = (concept: string) =>
  /\b(wire|line|lines|trace|conductor|connection|link|path)\b/.test(concept.toLowerCase());

/** Intersection over union of two [x, y, w, h] boxes. */
function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const ax2 = a[0] + a[2], ay2 = a[1] + a[3];
  const bx2 = b[0] + b[2], by2 = b[1] + b[3];
  const ix = Math.max(0, Math.min(ax2, bx2) - Math.max(a[0], b[0]));
  const iy = Math.max(0, Math.min(ay2, by2) - Math.max(a[1], b[1]));
  const inter = ix * iy;
  const union = a[2] * a[3] + b[2] * b[3] - inter;
  return union > 0 ? inter / union : 0;
}

const centreDist = (a: [number, number, number, number], b: [number, number, number, number]) =>
  Math.hypot((a[0] + a[2] / 2) - (b[0] + b[2] / 2), (a[1] + a[3] / 2) - (b[1] + b[3] / 2));

/** SAM reports half-open [l, t, r, b]; the rest of the app uses [x, y, w, h]. */
const toXYWH = (m: SamMask): [number, number, number, number] =>
  [m.bbox[0], m.bbox[1], Math.max(1, m.bbox[2] - m.bbox[0]), Math.max(1, m.bbox[3] - m.bbox[1])];

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const out = new Array<R>(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (;;) {
      const i = cursor++;
      if (i >= items.length) return;
      out[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function perceive(
  imageBuffer: Buffer,
  mime: string,
  signal?: AbortSignal,
): Promise<PerceiveResult> {
  const timings: Record<string, number> = {};
  const t0 = Date.now();
  const mark = (k: string, from: number) => { timings[k] = Date.now() - from; };

  const image = sharp(imageBuffer, { failOn: 'none' });
  const meta = await image.metadata();
  const imageW = meta.width ?? 0;
  const imageH = meta.height ?? 0;
  if (!imageW || !imageH) {
    throw new HttpError(400, "That file type isn't supported. Try a JPEG or PNG.", 'undecodable image');
  }

  // HEIC and anything else exotic is normalised to JPEG, which both models accept.
  const normalised = /jpe?g|png|webp/.test(mime) && imageBuffer.length < 4_000_000
    ? imageBuffer
    : await sharp(imageBuffer, { failOn: 'none' }).jpeg({ quality: 90 }).toBuffer();
  const dataUrl = `data:${normalised === imageBuffer ? mime : 'image/jpeg'};base64,${normalised.toString('base64')}`;

  // ── 1. Whole-page read ────────────────────────────────────────────────────
  const tSpark = Date.now();
  const reading = await readSketch(dataUrl, { signal });
  mark('spark_sketch_ms', tSpark);
  if (!reading) {
    throw new HttpError(500, 'Something went wrong analysing that. Try again.', 'spark returned no parseable JSON');
  }
  if (!reading.is_circuit || reading.components.length === 0) {
    throw new HttpError(
      422,
      "I couldn't find a circuit in that image. Try a clearer photo with better lighting.",
      'no circuit detected',
    );
  }

  const warnings: string[] = [];
  const notes = [...reading.notes];

  // Spark's permille boxes, in pixels. These are estimates; SAM replaces them below.
  let components: CircuitComponent[] = reading.components.map((c, i) => {
    const bb = c.bbox_permille;
    const bbox: [number, number, number, number] | null = Array.isArray(bb) && bb.length === 4
      ? [bb[0] / 1000 * imageW, bb[1] / 1000 * imageH, bb[2] / 1000 * imageW, bb[3] / 1000 * imageH]
      : null;
    return {
      id: c.id || `X${i + 1}`,
      type: normaliseType(c.type),
      value: c.value ?? null,
      unit: (c.unit as CircuitComponent['unit']) ?? null,
      orientation: c.orientation ?? null,
      bbox,
      mask_id: null,
      confidence: Number.isFinite(c.confidence) ? c.confidence : 0.6,
      pins: [],
    };
  });

  // ── 2. Segmentation ──────────────────────────────────────────────────────
  const concepts = reading.sam_concepts.length
    ? reading.sam_concepts.slice(0, 6)
    : ['drawn wire line', 'hand drawn circuit symbol'];
  if (!concepts.some(isWireConcept)) concepts.push('drawn wire line');

  const tSam = Date.now();
  const segmented = await segmentConcepts(dataUrl, concepts, { signal });
  mark('sam_ms', tSam);

  const allMasks = segmented.flatMap((s) => s.masks);
  const wireMasks = segmented.filter((s) => isWireConcept(s.concept)).flatMap((s) => s.masks);
  const symbolMasks = allMasks.filter((m) => !isWireConcept(m.concept));
  const samFailures = segmented.filter((s) => s.masks.length === 0 && s.diagnostics.some((d) => d.startsWith('request failed')));
  if (samFailures.length) {
    warnings.push(`Segmentation returned nothing for ${samFailures.length} of ${segmented.length} concepts, so some boxes are estimated rather than measured.`);
  }

  // ── 3. Replace estimated boxes with measured mask boxes ──────────────────
  const taken = new Set<number>();
  components = components.map((c) => {
    if (!c.bbox) return c;
    let best: { mask: SamMask; score: number } | null = null;
    for (const m of symbolMasks) {
      if (taken.has(m.mask_id)) continue;
      const box = toXYWH(m);
      const overlap = iou(c.bbox!, box);
      // Fall back to proximity when the estimate is off but plausible.
      const near = centreDist(c.bbox!, box) < Math.max(imageW, imageH) * 0.06;
      const score = overlap > 0 ? overlap : near ? 0.05 : 0;
      if (score > 0 && (!best || score > best.score)) best = { mask: m, score };
    }
    if (!best || best.score < 0.03) return c;
    taken.add(best.mask.mask_id);
    return { ...c, bbox: toXYWH(best.mask), mask_id: best.mask.mask_id, confidence: Math.max(c.confidence, best.mask.confidence ?? 0) };
  });

  const matched = components.filter((c) => c.mask_id != null).length;

  // ── 4. Deterministic connectivity from the wire mask ─────────────────────
  const tTrace = Date.now();
  let trace: TraceResult | null = null;
  if (wireMasks.length > 0 && components.some((c) => c.bbox)) {
    // Pins are placed from the canonical pin list, so fill it in first.
    const withPins = components.map((c) => ({ ...c, pins: pinsFor(c) }));
    trace = traceNets(withPins, wireMasks, imageW, imageH);
  }
  mark('trace_ms', tTrace);

  // ── 5. Per-crop value reading ────────────────────────────────────────────
  const tCrops = Date.now();
  const croppable = components.filter((c) => c.bbox && c.type !== 'junction');
  const crops = await mapLimit(croppable, CROP_CONCURRENCY, async (c) => {
    try {
      const [x, y, w, h] = c.bbox!;
      const padX = w * CROP_PAD;
      const padY = h * CROP_PAD;
      const left = Math.max(0, Math.round(x - padX));
      const top = Math.max(0, Math.round(y - padY));
      const width = Math.min(imageW - left, Math.round(w + padX * 2));
      const height = Math.min(imageH - top, Math.round(h + padY * 2));
      if (width < 8 || height < 8) return null;
      const buf = await sharp(imageBuffer, { failOn: 'none' })
        .extract({ left, top, width, height })
        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: false })
        .jpeg({ quality: 92 })
        .toBuffer();
      return await readComponentCrop(
        `data:image/jpeg;base64,${buf.toString('base64')}`,
        { type: c.type, id: c.id },
        { signal },
      );
    } catch {
      return null; // One unreadable crop must not sink the analysis.
    }
  });
  mark('crops_ms', tCrops);

  let valueConfSum = 0;
  let valueConfCount = 0;
  const byId = new Map(components.map((c) => [c.id, c]));
  croppable.forEach((c, i) => {
    const crop = crops[i];
    if (!crop) return;
    const target = byId.get(c.id)!;
    // The crop is the better witness for the value and the polarity; the page-level
    // read stays authoritative for the type unless the crop is clearly confident.
    if (crop.value != null && crop.value !== '') {
      target.value = String(crop.value);
      target.unit = (crop.unit as CircuitComponent['unit']) ?? target.unit;
    }
    if (crop.orientation) target.orientation = crop.orientation;
    const cropType = normaliseType(crop.type);
    if (cropType !== 'unknown' && cropType !== target.type && crop.confidence >= 0.85 && crop.confidence > target.confidence) {
      notes.push(`${target.id} was re-read as a ${cropType.replace(/_/g, ' ')} from its isolated crop.`);
      target.type = cropType;
    }
    if (crop.note) notes.push(`${target.id}: ${crop.note}`);
    valueConfSum += crop.value_confidence;
    valueConfCount++;
  });

  // Pins depend on the final type, so fill them in now.
  components = components.map((c) => ({ ...c, pins: pinsFor(c) }));

  // ── 6. Reconcile connectivity ────────────────────────────────────────────
  const sparkNets: Net[] = reading.nets
    .filter((n) => Array.isArray(n.pins) && n.pins.length > 0)
    .map((n, i) => ({ id: `S${i + 1}`, pins: n.pins.map(String), is_ground: n.is_ground, source: 'model' as const }));

  const traceUsable = trace != null && trace.coverage >= TRACE_COVERAGE_MIN && trace.nets.length >= 2;
  let nets: Net[];
  if (traceUsable) {
    nets = markGround(trace!.nets, components);
  } else {
    nets = sparkNets;
    if (trace) {
      warnings.push(
        trace.nets.length < 2
          ? 'The wire mask did not resolve into separate connections, so connectivity came from the model rather than from the traced lines. Check each connection.'
          : `Only ${Math.round(trace.coverage * 100)}% of component leads could be traced to a drawn wire, so connectivity came from the model rather than from the traced lines. Check each connection.`,
      );
    } else if (wireMasks.length === 0) {
      warnings.push('No wire lines were segmented, so connectivity came from the model rather than from the traced lines. Check each connection.');
    }
  }
  if (nets.length === 0) {
    warnings.push('No connections could be recovered from this image. The components below were still identified.');
  }

  // ── 7. Confidence ────────────────────────────────────────────────────────
  const componentConf = components.length
    ? components.reduce((a, c) => a + c.confidence, 0) / components.length
    : 0;
  // Measured geometry is worth more than a described box, so matching masks lifts
  // component confidence; an unverified estimate holds it down.
  const matchRatio = components.length ? matched / components.length : 0;
  const connectivityConf = traceUsable
    ? Math.min(0.99, 0.6 + 0.39 * trace!.coverage)
    : Math.min(reading.confidence.connectivity, 0.7);
  const confidence: Confidence = {
    components: clamp01(componentConf * (0.8 + 0.2 * matchRatio)),
    connectivity: clamp01(connectivityConf),
    values: clamp01(valueConfCount ? valueConfSum / valueConfCount : reading.confidence.values),
  };

  if (confidence.connectivity < 0.85) {
    warnings.push(`Connectivity confidence is ${confidence.connectivity.toFixed(2)} — below 0.85. Verify the connections before trusting the findings.`);
  }
  if (confidence.values < 0.7) {
    warnings.push('Some handwritten values were hard to read. Check the values in the inspector.');
  }
  if (confidence.components < 0.7) {
    warnings.push('Some symbols were hard to identify. Correct any wrong component types in the inspector.');
  }

  mark('total_ms', t0);

  return {
    components,
    nets,
    confidence,
    warnings,
    notes,
    segmentation: {
      concept_counts: Object.fromEntries(segmented.map((s) => [s.concept, s.masks.length])),
      masks: allMasks.slice(0, 40).map((m) => ({
        mask_id: m.mask_id,
        concept: m.concept,
        bbox: toXYWH(m),
        confidence: m.confidence,
        svg_path: m.svg_path,
      })),
      image_width: imageW,
      image_height: imageH,
      wire_trace_used: traceUsable,
    },
    timings: {
      ...timings,
      ...(trace ? { trace_coverage: Math.round(trace.coverage * 100), trace_regions: trace.regions } : {}),
      sam_concepts: concepts.length,
      sam_masks: allMasks.length,
    },
  };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

const pinsFor = (c: CircuitComponent): string[] => [...PINS[c.type]];
