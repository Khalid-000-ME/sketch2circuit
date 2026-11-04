/**
 * POST /api/part — describe a part, get a verified definition back.
 *
 * Body: { description: string }. The model call is the slow part (tens of
 * seconds, and up to three rounds when a first attempt fails its own checks), so
 * the route has an overall budget and says so plainly when it runs out.
 */

import { NextResponse } from 'next/server';
import { designPart } from '@/lib/meta/part';
import { hasApiKey } from '@/lib/meta/client';
import { HttpError } from '@/lib/types';

export const maxDuration = 240;

const MAX_DESCRIPTION = 600;
const BUDGET_MS = Number(process.env.PART_BUDGET_MS ?? 200_000);

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as { description?: unknown } | null;
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    if (description.length < 3) {
      throw new HttpError(400, 'Describe the part first, for example "a 5 V relay with one normally open contact".', 'empty description');
    }
    if (description.length > MAX_DESCRIPTION) {
      throw new HttpError(400, `Keep the description under ${MAX_DESCRIPTION} characters.`, 'description too long');
    }
    if (!hasApiKey()) {
      throw new HttpError(503, 'Describing parts needs the Meta Model API key, which this server does not have.', 'MODEL_API_KEY is not set');
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), BUDGET_MS);
    try {
      const result = await designPart(description, { signal: controller.signal });
      return NextResponse.json({
        buildable: result.buildable,
        reason: result.reason,
        part: result.def,
        checks: result.results,
        verified: result.verified,
        attempts: result.attempts,
        problems: result.problems,
      });
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    if (err instanceof HttpError) {
      // The shared transport words a timeout for a photo; this is a part.
      const message = err.status === 504
        ? 'The model took too long to design that part. Try again, or describe it more simply.'
        : err.userMessage;
      return NextResponse.json({ error: message }, { status: err.status });
    }
    console.error('[part]', err);
    return NextResponse.json({ error: 'That part could not be made. Try again.' }, { status: 500 });
  }
}
