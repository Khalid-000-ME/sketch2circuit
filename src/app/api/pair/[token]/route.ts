/**
 * /api/pair/[token]
 *   GET  — the desktop polls this to learn whether a photo has arrived.
 *   POST — the phone sends the photo here.
 */

import { NextResponse } from 'next/server';
import { MAX_PAIR_BYTES, TOKEN_RE, putImage, statusOf } from '@/lib/pair/store';

const NO_STORE = { 'Cache-Control': 'no-store' };
const ACCEPTED = /^image\/(jpeg|jpg|png|webp|heic|heif|avif)$/i;

export async function GET(_req: Request, ctx: RouteContext<'/api/pair/[token]'>) {
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) return NextResponse.json({ status: 'expired' }, { status: 404, headers: NO_STORE });
  return NextResponse.json(statusOf(token), { headers: NO_STORE });
}

export async function POST(req: Request, ctx: RouteContext<'/api/pair/[token]'>) {
  const { token } = await ctx.params;
  if (!TOKEN_RE.test(token)) {
    return NextResponse.json({ error: 'That link is not valid.' }, { status: 404, headers: NO_STORE });
  }

  const form = await req.formData().catch(() => null);
  const file = form?.get('image');
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: 'No photo was attached.' }, { status: 400, headers: NO_STORE });
  }
  if (file.size > MAX_PAIR_BYTES) {
    return NextResponse.json({ error: 'That photo is too large. Try one under 10MB.' }, { status: 413, headers: NO_STORE });
  }
  const mime = file.type || 'image/jpeg';
  if (!ACCEPTED.test(mime)) {
    return NextResponse.json({ error: "That file type isn't supported. Try a JPEG or PNG." }, { status: 400, headers: NO_STORE });
  }

  const ok = putImage(token, Buffer.from(await file.arrayBuffer()), mime);
  if (!ok) {
    // 410, not 404: the link was real, and has finished or timed out.
    return NextResponse.json({ error: 'This session has ended. Scan the code again.' }, { status: 410, headers: NO_STORE });
  }
  return NextResponse.json({ status: 'ready' }, { headers: NO_STORE });
}
