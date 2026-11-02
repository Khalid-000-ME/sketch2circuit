/**
 * SAM 3.1 segmentation.
 *
 * SAM takes one noun-phrase concept and one image per request, so a sketch with
 * four kinds of symbol costs four calls — issued concurrently. Each call returns
 * a box and a pixel-accurate mask per match, which is what the rest of the
 * pipeline is built on:
 *
 *   • component masks give us per-symbol crops, so handwritten values are read
 *     from an isolated region instead of from the whole page;
 *   • the wire mask gives us a raster we can walk deterministically to recover
 *     connectivity, instead of asking a language model to guess which line
 *     touches which lead.
 *
 * Neither is something a single whole-image VLM call can do, which is the point.
 */

import {
  buildObjectPrompt, decodeMaskToRaster, decodeMaskToSVGPath, parseImageStream, recordsOfKind,
  type PromptBox,
} from '@meta-sam/parser';
import { SAM_MODEL, postStream, sseEvents, type MetaRequestOptions } from './client';

export interface SamMask {
  mask_id: number;
  concept: string;
  /** Half-open source-pixel box. */
  bbox: [left: number, top: number, right: number, bottom: number];
  confidence: number | null;
  /** The id SAM reported this object under. For a box prompt, the id we supplied. */
  objectId?: string;
  /** Row-major 0/1 raster covering `bbox`, width `w` and height `h`. */
  raster: Uint8Array;
  w: number;
  h: number;
  /** The mask as an SVG path in mask-local space, for the UI overlay. */
  svg_path?: string;
}

export interface SamConceptResult {
  concept: string;
  masks: SamMask[];
  diagnostics: string[];
}

/** Shared tail: drive the parser to its result and turn records into SamMasks. */
async function collectMasks(
  res: Response,
  concept: string,
  startId: number,
): Promise<{ masks: SamMask[]; diagnostics: string[] }> {
  const stream = parseImageStream(sseEvents(res));
  // Draining the event iterator is what drives the parser to its final result.
  for await (const _snapshot of stream) void _snapshot;
  const result = await stream.finalResult;

  const boxes = new Map(recordsOfKind(result.records, 'box').map((b) => [b.objectId, b]));
  const masks: SamMask[] = [];
  let id = startId;

  for (const rec of recordsOfKind(result.records, 'mask')) {
    const box = boxes.get(rec.objectId);
    const bounds = rec.bounds;
    let raster: Uint8Array;
    try {
      raster = decodeMaskToRaster(rec.mask);
    } catch {
      continue; // A mask we cannot decode is dropped rather than failing the run.
    }
    let svg_path: string | undefined;
    try { svg_path = decodeMaskToSVGPath(rec.mask); } catch { svg_path = undefined; }

    masks.push({
      mask_id: id++,
      svg_path,
      concept,
      objectId: rec.objectId,
      bbox: [
        Math.round(bounds?.left ?? box?.left ?? 0),
        Math.round(bounds?.top ?? box?.top ?? 0),
        Math.round(bounds?.right ?? box?.right ?? 0),
        Math.round(bounds?.bottom ?? box?.bottom ?? 0),
      ],
      confidence: rec.confidence ?? box?.confidence ?? null,
      raster,
      w: rec.mask.width,
      h: rec.mask.height,
    });
  }

  return { masks, diagnostics: result.diagnostics.map((d) => `${d.code}: ${d.message}`) };
}

/**
 * Refines approximate boxes into exact masks.
 *
 * This is the path that makes segmentation reliable rather than best-effort. A
 * noun phrase only finds what SAM recognises as a thing, and on a pencil sketch
 * some symbols simply are not findable that way — a battery drawn as four thin
 * parallel lines returns nothing for every phrasing we tried. A box prompt has
 * no such failure mode: it asks SAM to segment *this region*, and it answers
 * under the id we gave it, so the result is one exact mask per component with no
 * matching step and no ambiguity.
 *
 * One request covers every component on the page.
 */
export async function segmentByBoxes(
  imageDataUrl: string,
  size: { width: number; height: number },
  objects: Array<{ id: number; box: PromptBox }>,
  opts: MetaRequestOptions & { nextMaskId?: number } = {},
): Promise<SamConceptResult> {
  if (objects.length === 0) return { concept: BOX_PROMPT_CONCEPT, masks: [], diagnostics: [] };

  let prompt: string;
  try {
    prompt = buildObjectPrompt({
      size,
      objects: objects.map((o) => ({ id: o.id, prompts: [{ box: o.box }] })),
    });
  } catch (err) {
    // An un-encodable box (out of bounds, zero area) is a caller bug, not an
    // outage: report it and let the noun-phrase masks carry the run.
    return { concept: BOX_PROMPT_CONCEPT, masks: [], diagnostics: [`prompt rejected: ${err}`] };
  }

  const res = await postStream('/responses', {
    model: SAM_MODEL,
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: imageDataUrl },
      ],
    }],
    metadata: { include_confidence: 'true' },
  }, { timeoutMs: 60_000, ...opts });

  const { masks, diagnostics } = await collectMasks(res, BOX_PROMPT_CONCEPT, opts.nextMaskId ?? 0);
  return { concept: BOX_PROMPT_CONCEPT, masks, diagnostics };
}

/** The concept label used for masks that came from box prompts. */
export const BOX_PROMPT_CONCEPT = 'component (box prompt)';

/**
 * Phrasings always asked for, whatever the page-reading stage proposes.
 *
 * Wire recall varies sharply with wording and sketch: on one bundled sample
 * "drawn wire line" returns the whole lower run and misses the upper one
 * entirely, while the bare "line" finds the upper run. They are unioned because
 * a missed wire silently costs a connection, and each phrasing is one cheap
 * request.
 */
export const DEFAULT_WIRE_CONCEPTS = ['drawn wire line', 'line'] as const;

/**
 * Rules out ruled paper and margin lines.
 *
 * Asking for "line" on lined paper also returns the paper. Page furniture is
 * recognisable by shape rather than by content: it runs essentially the full
 * width or height of the sheet while being a few pixels thick. A drawn circuit
 * never reaches the paper's edge, so nothing real is lost.
 */
export function isPageFurniture(mask: SamMask, imageW: number, imageH: number): boolean {
  const w = mask.bbox[2] - mask.bbox[0];
  const h = mask.bbox[3] - mask.bbox[1];
  const spansHeight = h >= imageH * 0.95 && w <= imageW * 0.03;
  const spansWidth = w >= imageW * 0.95 && h <= imageH * 0.03;
  return spansHeight || spansWidth;
}

/**
 * Segments one concept. Returns an empty mask list when the concept is absent —
 * which the API signals with an empty output and is a normal result, not an error.
 */
export async function segmentConcept(
  imageDataUrl: string,
  concept: string,
  opts: MetaRequestOptions & { nextMaskId?: number } = {},
): Promise<SamConceptResult> {
  const res = await postStream('/responses', {
    model: SAM_MODEL,
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: concept },
        { type: 'input_image', image_url: imageDataUrl },
      ],
    }],
    metadata: { include_confidence: 'true', mask_encoding: 'lossless' },
  }, { timeoutMs: 45_000, ...opts });

  const { masks, diagnostics } = await collectMasks(res, concept, opts.nextMaskId ?? 0);
  return { concept, masks, diagnostics };
}

/** Segments several concepts concurrently, keeping mask ids globally unique. */
export async function segmentConcepts(
  imageDataUrl: string,
  concepts: string[],
  opts: MetaRequestOptions = {},
): Promise<SamConceptResult[]> {
  const unique = [...new Set(concepts.map((c) => c.trim().toLowerCase()).filter(Boolean))];
  const settled = await Promise.allSettled(
    unique.map((concept) => segmentConcept(imageDataUrl, concept, opts)),
  );
  const out: SamConceptResult[] = [];
  let next = 0;
  for (const [i, s] of settled.entries()) {
    if (s.status === 'rejected') {
      out.push({ concept: unique[i], masks: [], diagnostics: [`request failed: ${s.reason}`] });
      continue;
    }
    // Re-number so ids are unique across concepts regardless of completion order.
    const masks = s.value.masks.map((m) => ({ ...m, mask_id: next++ }));
    out.push({ ...s.value, masks });
  }
  return out;
}
