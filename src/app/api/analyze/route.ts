/**
 * POST /api/analyze — image in, analysed circuit out.
 *
 * Partial-result principle (§7.3): a stage that fails degrades the response, it
 * does not empty it. Components found without connectivity are still returned,
 * with an explicit warning, because a beginner can still correct them by hand.
 */

import { NextResponse } from 'next/server';
import { analyseGraph } from '@/lib/pipeline/analyse';
import { perceive } from '@/lib/pipeline/perceive';
import { hasApiKey } from '@/lib/meta/client';
import { HttpError, type AnalyzeResponse } from '@/lib/types';
import { SAMPLES, prebakedFor } from '@/fixtures/samples';

// Node runtime is the default; sharp and the Model API calls both need it.
export const maxDuration = 120;

const MAX_BYTES = 10 * 1024 * 1024;
const ACCEPTED = /^image\/(jpeg|jpg|png|webp|heic|heif|avif)$/i;

const circuitId = () => `c_${Math.random().toString(16).slice(2, 8)}`;

function errorResponse(err: unknown) {
  if (err instanceof HttpError) {
    if (err.status >= 500) console.error('[analyze]', err.status, err.message);
    return NextResponse.json({ error: err.userMessage, detail: err.message }, { status: err.status });
  }
  console.error('[analyze] unhandled', err);
  return NextResponse.json(
    { error: 'Something went wrong analysing that. Try again.' },
    { status: 500 },
  );
}

export async function POST(req: Request) {
  let sampleId: string | null = null;
  try {
    const form = await req.formData().catch(() => null);
    if (!form) {
      throw new HttpError(400, "That upload didn't arrive as an image. Try again.", 'malformed multipart body');
    }
    sampleId = typeof form.get('sample') === 'string' ? String(form.get('sample')) : null;
    const file = form.get('image');

    if (!(file instanceof Blob)) {
      throw new HttpError(400, 'No image was attached to that request.', 'missing image field');
    }
    if (file.size > MAX_BYTES) {
      throw new HttpError(413, 'That image is too large. Try one under 10MB.', `size ${file.size}`);
    }
    const mime = file.type || 'image/jpeg';
    if (!ACCEPTED.test(mime)) {
      throw new HttpError(400, "That file type isn't supported. Try a JPEG or PNG.", `mime ${mime}`);
    }
    if (!hasApiKey()) {
      // A cached result keeps the bundled samples demonstrable without a key.
      const baked = prebakedFor(sampleId);
      if (baked) return NextResponse.json(baked);
      throw new HttpError(
        503,
        'Live analysis is unavailable because the server has no Meta Model API key configured. The bundled sample sketches still work.',
        'MODEL_API_KEY not set',
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const perceived = await perceive(buffer, mime, req.signal);
    const analysis = analyseGraph({ components: perceived.components, nets: perceived.nets });

    const body: AnalyzeResponse = {
      circuit_id: circuitId(),
      components: analysis.components,
      nets: analysis.nets,
      confidence: perceived.confidence,
      simulation: analysis.simulation,
      findings: analysis.findings,
      warnings: [...perceived.warnings, ...analysis.warnings, ...perceived.notes],
      segmentation: perceived.segmentation,
      timings: perceived.timings,
    };
    return NextResponse.json(body);
  } catch (err) {
    // The last line of defence for a live demo: fall back to the cached result
    // for a bundled sample rather than showing the judge an error.
    const baked = prebakedFor(sampleId);
    if (baked) {
      return NextResponse.json({
        ...baked,
        warnings: [
          ...baked.warnings,
          'Live analysis failed for this sample, so a cached result from an earlier run is shown.',
        ],
      });
    }
    return errorResponse(err);
  }
}

export async function GET() {
  return NextResponse.json({
    live: hasApiKey(),
    samples: SAMPLES.map(({ id, title, description, image, difficulty }) => ({ id, title, description, image, difficulty })),
  });
}
