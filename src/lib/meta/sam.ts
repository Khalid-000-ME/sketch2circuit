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

import { decodeMaskToRaster, decodeMaskToSVGPath, parseImageStream, recordsOfKind } from '@meta-sam/parser';
import { SAM_MODEL, postStream, sseEvents, type MetaRequestOptions } from './client';

export interface SamMask {
  mask_id: number;
  concept: string;
  /** Half-open source-pixel box. */
  bbox: [left: number, top: number, right: number, bottom: number];
  confidence: number | null;
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

  const stream = parseImageStream(sseEvents(res));
  // Draining the event iterator is what drives the parser to its final result.
  for await (const _snapshot of stream) void _snapshot;
  const result = await stream.finalResult;

  const boxes = new Map(recordsOfKind(result.records, 'box').map((b) => [b.objectId, b]));
  const masks: SamMask[] = [];
  let id = opts.nextMaskId ?? 0;

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

  return {
    concept,
    masks,
    diagnostics: result.diagnostics.map((d) => `${d.code}: ${d.message}`),
  };
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
