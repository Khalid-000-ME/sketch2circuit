/**
 * The perception stage: SAM 3.1 and Muse Spark composed into one circuit graph.
 *
 * The order matters and is the whole argument for using both models rather than
 * one:
 *
 *   1. Spark reads the page once and says what is there, roughly where, and which
 *      noun phrases describe the drawn wires. A segmentation model cannot do
 *      this — it has to be told what to look for, and it cannot read "220".
 *   2. SAM refines Spark's approximate boxes into exact masks, one request for
 *      the whole page, each answering under the id we supplied. A language model
 *      cannot do this — it does not produce pixels.
 *   3. SAM segments the drawn wire lines by noun phrase, and that mask is walked
 *      deterministically to recover connectivity (`trace.ts`). This is the stage
 *      that decides whether the product works at all.
 *   4. Each component is cropped from its own refined box and sent back to Spark
 *      alone, so a handwritten "220" is read from a frame it fills rather than
 *      from a corner of a photograph.
 *
 * Remove either model and a numbered step above has no replacement.
 *
 * Step 2 uses box prompts rather than noun phrases because noun phrases have a
 * hard failure mode on pencil drawings: a battery drawn as four thin parallel
 * lines returned zero masks for every phrasing we tried against the live API,
 * while a box prompt over the same region returns a clean mask. Boxes also give
 * a 1:1 component-to-mask correspondence, so there is no matching step to get
 * wrong.
 */

import sharp from 'sharp';
import type { CircuitComponent, CircuitGraph, Confidence, Net } from '../types';
import { HttpError, PINS } from '../types';
import { normaliseType } from '../circuit/graph';
import { isBoardType } from '../circuit/boards';
import { readComponentCrop, readSketch } from '../meta/spark';
import {
  DEFAULT_WIRE_CONCEPTS, isPageFurniture, segmentByBoxes, segmentConcepts, type SamMask,
} from '../meta/sam';
import { gridSize, markGround, reconcileNets, traceNets, type TraceResult } from './trace';
import { inkRaster, removeRuledLines } from './ink';

/**
 * Below this pin coverage the mask walk has not established enough structure to
 * build on, and the model's netlist is used wholesale. Above it, the walk leads
 * and the model only fills the gaps (`reconcileNets`).
 */
const TRACE_COVERAGE_MIN = 0.4;
/** Concurrent per-crop Spark calls. */
const CROP_CONCURRENCY = 4;
/** Padding around a component's mask box when cropping, as a fraction of its size. */
const CROP_PAD = 0.55;
/**
 * How much the page-reading stage's estimated box is padded before it is handed
 * to SAM as a box prompt.
 *
 * SAM segments within the region it is given, so a tight prompt yields a tight
 * mask: prompted with an estimate that clipped a resistor's zigzag, it returns
 * the clipped zigzag. Prompted with the same box padded, it returns the whole
 * symbol. The estimate is an estimate, so the prompt gives it room.
 */
const BOX_PROMPT_PAD = 0.22;
/** Components the page read was at least this sure of are not re-read from a crop. */
const CROP_CONFIDENCE_FLOOR = 0.9;

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

  /*
   * The wire segmentation needs nothing from the page read — the phrasings that
   * actually find drawn lines are fixed — so it is started first and runs
   * alongside it. That takes a whole SAM round trip off the critical path, which
   * is most of the difference between an analysis that feels slow and one that
   * does not.
   */
  const tWires = Date.now();
  const wirePromise = segmentConcepts(dataUrl, [...DEFAULT_WIRE_CONCEPTS], { signal })
    .then((r) => { mark('sam_wires_ms', tWires); return r; });
  // A rejection here is handled where the result is awaited; this keeps Node from
  // treating it as unhandled in the meantime.
  wirePromise.catch(() => {});

  // ── 1. Whole-page read ────────────────────────────────────────────────────
  const tSpark = Date.now();
  const reading = await readSketch(dataUrl, { signal }).catch((err) => {
    wirePromise.catch(() => {});
    throw err;
  });
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
  // Two SAM passes: box prompts for the components (exact, 1:1, no failure mode
  // on thin pencil symbols) and noun phrases for the drawn wires, which have no
  // box to prompt with and are what the connectivity walk consumes.
  const wireConcepts = [...DEFAULT_WIRE_CONCEPTS];

  const boxObjects = components
    .map((c, i) => ({ component: c, index: i }))
    .filter(({ component }) => component.bbox != null)
    .map(({ component, index }) => {
      const [x, y, w, h] = component.bbox!;
      const padX = Math.max(8, w * BOX_PROMPT_PAD);
      const padY = Math.max(8, h * BOX_PROMPT_PAD);
      // Clamp to the image and guarantee a non-empty box, or the prompt builder
      // rejects the whole request.
      const left = Math.max(0, Math.min(imageW - 2, Math.round(x - padX)));
      const top = Math.max(0, Math.min(imageH - 2, Math.round(y - padY)));
      return {
        id: index,
        componentId: component.id,
        box: {
          left,
          top,
          right: Math.max(left + 1, Math.min(imageW, Math.round(x + w + padX))),
          bottom: Math.max(top + 1, Math.min(imageH, Math.round(y + h + padY))),
        },
      };
    });

  const tSam = Date.now();
  const [boxResult, conceptResults] = await Promise.all([
    segmentByBoxes(
      dataUrl,
      { width: imageW, height: imageH },
      boxObjects.map(({ id, box }) => ({ id, box })),
      { signal, nextMaskId: 0 },
    ),
    // Already in flight since before the page read returned.
    wirePromise,
  ]);
  mark('sam_boxes_ms', tSam);

  // Keep mask ids unique across both passes.
  const conceptMasks = conceptResults.flatMap((r) => r.masks)
    .map((m, i) => ({ ...m, mask_id: boxResult.masks.length + i }));
  const segmented = [boxResult, ...conceptResults];
  const allMasks = [...boxResult.masks, ...conceptMasks];
  const wireMasks = conceptMasks
    .filter((m) => isWireConcept(m.concept))
    .filter((m) => !isPageFurniture(m, imageW, imageH));
  const symbolMasks = [
    ...boxResult.masks,
    ...conceptMasks.filter((m) => !isWireConcept(m.concept)),
  ];

  if (wireMasks.length === 0) {
    warnings.push('No wire lines could be segmented from this image, so connectivity could not be traced from the drawing itself.');
  }
  const boxFailures = boxResult.diagnostics.filter((d) => d.startsWith('prompt rejected') || d.startsWith('request failed'));
  if (boxFailures.length) {
    warnings.push('Component outlines could not be measured for this image, so their positions are estimated rather than segmented.');
  }

  // ── 3. Replace estimated boxes with measured mask boxes ──────────────────
  // The box-prompt masks come back under the id we supplied, so this is a lookup
  // rather than a match. Only components SAM declined to segment fall through to
  // the geometric matching below.
  const byObjectId = new Map(boxResult.masks.map((m) => [String(m.objectId ?? ''), m]));
  const claimed = new Set<number>();
  components = components.map((c, i) => {
    const direct = byObjectId.get(String(i));
    if (!direct) return c;
    claimed.add(direct.mask_id);
    return {
      ...c,
      bbox: toXYWH(direct),
      mask_id: direct.mask_id,
      confidence: Math.max(c.confidence, direct.confidence ?? 0),
    };
  });

  // Fallback for anything still unmeasured: nearest noun-phrase mask by overlap.
  const taken = new Set<number>(claimed);
  components = components.map((c) => {
    if (c.mask_id != null || !c.bbox) return c;
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

  // The ink layer: every stroke on the page, thresholded locally so uneven
  // lighting does not wipe out half the drawing. Components are erased from it
  // inside the trace, and what is left is wire.
  const { w: gw, h: gh } = gridSize(imageW, imageH);
  let ink: Uint8Array | undefined;
  try {
    ink = await inkRaster(imageBuffer, gw, gh);
    const ruled = removeRuledLines(ink, gw, gh);
    timings.ink_pixels = ink.reduce((a: number, b: number) => a + b, 0);
    timings.ink_ruled_lines_removed = ruled;
  } catch {
    // Thresholding failing is survivable: the SAM wire masks still carry the trace.
    ink = undefined;
  }

  if ((ink || wireMasks.length > 0) && components.some((c) => c.bbox)) {
    // Pins are placed from the canonical pin list, so fill it in first.
    const withPins = components.map((c) => ({ ...c, pins: pinsFor(c) }));
    const maskById = new Map<string, SamMask>();
    for (const c of components) {
      const m = c.mask_id != null ? allMasks.find((x) => x.mask_id === c.mask_id) : undefined;
      if (m) maskById.set(c.id, m);
    }
    trace = traceNets(withPins, wireMasks, imageW, imageH, maskById, ink);
  }
  mark('trace_ms', tTrace);

  /*
   * ── 5. Per-crop value reading ───────────────────────────────────────────
   *
   * Only what the page read was unsure about. The whole-page pass frequently
   * reads every value correctly, and re-reading a confidently-read "220" from
   * its own crop costs several seconds to confirm what is already known. So the
   * crop pass is spent where it has something to add: a value that came back
   * empty, a symbol the model was hesitant about, or a part whose polarity
   * matters and was not reported.
   */
  const needsCrop = (c: CircuitComponent): boolean => {
    if (!c.bbox || c.type === 'junction' || c.type === 'ground') return false;
    const expectsValue = !['ground', 'junction', 'switch', 'transistor', 'ic', 'header', 'crystal', 'arduino_uno', 'raspberry_pi'].includes(c.type);
    if (expectsValue && (c.value == null || c.value === '')) return true;
    if (c.confidence < CROP_CONFIDENCE_FLOOR) return true;
    const polarised = ['led', 'diode', 'battery', 'capacitor_electrolytic'].includes(c.type);
    return polarised && !c.orientation;
  };

  const tCrops = Date.now();
  const croppable = components.filter(needsCrop);
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
  timings.crops_requested = croppable.length;

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

  const traceUsable = trace != null && trace.coverage >= TRACE_COVERAGE_MIN && trace.nets.length >= 1;
  let nets: Net[];
  let inferredPins: string[] = [];
  if (traceUsable) {
    // A board's pins have no geometry to trace, only a label the model read, so
    // they never appear among the trace's anchors. They are still part of the
    // circuit, and the model's nets are where they come from: each joins the
    // traced net that the model says its wire is part of.
    const anchored = new Set(trace!.anchors.map((a) => a.ref));
    const boardIds = new Set(components.filter((c) => isBoardType(c.type)).map((c) => c.id));
    const unanchored = sparkNets
      .flatMap((n) => n.pins)
      .filter((ref) => !anchored.has(ref) && boardIds.has(ref.slice(0, ref.lastIndexOf('.'))));
    const reconciled = reconcileNets(trace!.nets, sparkNets, [...trace!.floating, ...unanchored]);
    nets = markGround(reconciled.nets, components);
    inferredPins = reconciled.inferred;
    // Two different things were supplied by the model, and only one of them is a
    // shortfall. A lead the trace could not place is a gap. A board pin was never
    // going to be traced — the label is all there is — so it is a method, noted
    // once, and it must not count against how much of the drawing was measured.
    const traceable = inferredPins.filter((p) => anchored.has(p));
    const fromLabels = inferredPins.filter((p) => !anchored.has(p));
    if (traceable.length > 0) {
      warnings.push(
        `${traceable.length} of ${trace!.anchors.length} component leads could not be traced to a drawn wire, so ${traceable.length === 1 ? 'that connection was' : 'those connections were'} taken from the model instead: ${traceable.join(', ')}. Check ${traceable.length === 1 ? 'it' : 'them'} in the inspector.`,
      );
    }
    if (fromLabels.length > 0) {
      warnings.push(
        `Which board pin each wire reaches was read from the labels, not traced: ${fromLabels.join(', ')}. Check them against your sketch.`,
      );
    }
    if (reconciled.stillFloating.length > 0) {
      warnings.push(
        `${reconciled.stillFloating.join(', ')} ${reconciled.stillFloating.length === 1 ? 'connects' : 'connect'} to nothing that could be found in the drawing.`,
      );
    }
  } else {
    nets = sparkNets;
    if (trace) {
      warnings.push(
        `Only ${Math.round(trace.coverage * 100)}% of component leads could be traced to a drawn wire, so connectivity came from the model rather than from the traced lines. Check each connection.`,
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
  // Confidence tracks the share of leads actually measured rather than inferred,
  // so a reconciled result is honest about the part the model supplied.
  const anchoredRefs = new Set(trace?.anchors.map((a) => a.ref) ?? []);
  const gaps = inferredPins.filter((p) => anchoredRefs.has(p)).length;
  const verifiedShare = traceUsable && trace!.anchors.length
    ? Math.max(0, (trace!.anchors.length - gaps) / trace!.anchors.length)
    : 0;
  const connectivityConf = traceUsable
    ? Math.min(0.99, 0.55 + 0.44 * verifiedShare)
    : Math.min(reading.confidence.connectivity, 0.7);
  const confidence: Confidence = {
    components: clamp01(componentConf * (0.8 + 0.2 * matchRatio)),
    connectivity: clamp01(connectivityConf),
    // Where no crop was needed the page read's own assessment stands; where crops
    // ran, they are the better witness and are blended with it.
    values: clamp01(
      valueConfCount
        ? (valueConfSum + reading.confidence.values * (components.length - valueConfCount))
          / Math.max(1, components.length)
        : reading.confidence.values,
    ),
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
      concept_counts: Object.fromEntries(segmented.map((r) => [r.concept, r.masks.length])),
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
      sam_wire_concepts: wireConcepts.length,
      sam_box_prompts: boxObjects.length,
      sam_box_masks: boxResult.masks.length,
      sam_masks: allMasks.length,
    },
  };
}

const clamp01 = (n: number) => (Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0);

const pinsFor = (c: CircuitComponent): string[] => [...PINS[c.type]];
