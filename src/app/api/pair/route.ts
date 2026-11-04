/** POST /api/pair — open a pairing session and say where the phone should go. */

import { NextResponse } from 'next/server';
import { phoneOrigin } from '@/lib/pair/origin';
import { createSession } from '@/lib/pair/store';

export async function POST(req: Request) {
  const { token, expiresAt } = createSession();
  const { origin, reachable } = phoneOrigin(req);
  return NextResponse.json(
    { token, url: `${origin}/m/${token}`, expiresAt, reachable },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
