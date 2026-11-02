/**
 * POST /api/simulate — the edit path. Takes the graph the client is holding,
 * skips all vision work, returns the new operating point and findings.
 *
 * No model calls, so this answers in single-digit milliseconds, which is what
 * makes editing a value feel like turning a knob rather than submitting a form.
 */

import { NextResponse } from 'next/server';
import { analyseGraph } from '@/lib/pipeline/analyse';
import { HttpError, type CircuitGraph, type SimulateResponse } from '@/lib/types';

export const runtime = 'nodejs';

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as CircuitGraph | null;
    if (!body || !Array.isArray(body.components)) {
      throw new HttpError(400, 'That edit could not be read. Reload and try again.', 'malformed graph');
    }
    const analysis = analyseGraph({ components: body.components, nets: body.nets ?? [] });
    const res: SimulateResponse = {
      simulation: analysis.simulation,
      findings: analysis.findings,
      warnings: analysis.warnings,
    };
    return NextResponse.json(res);
  } catch (err) {
    if (err instanceof HttpError) {
      return NextResponse.json({ error: err.userMessage }, { status: err.status });
    }
    console.error('[simulate]', err);
    return NextResponse.json({ error: 'That edit could not be simulated.' }, { status: 500 });
  }
}
