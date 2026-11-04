/** GET /api/pair/[token]/image — the desktop collects the photo. Once only. */

import { TOKEN_RE, takeImage } from '@/lib/pair/store';

export async function GET(_req: Request, ctx: RouteContext<'/api/pair/[token]/image'>) {
  const { token } = await ctx.params;
  const image = TOKEN_RE.test(token) ? takeImage(token) : null;
  if (!image) return new Response('Not ready', { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return new Response(new Uint8Array(image.data), {
    headers: { 'Content-Type': image.mime, 'Cache-Control': 'no-store' },
  });
}
