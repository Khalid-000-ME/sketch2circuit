/** Is SAM's wire segmentation reproducible, and does temperature affect it? */
import { readFileSync } from 'node:fs';
import { parseImageStream, recordsOfKind } from '@meta-sam/parser';

const BASE = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';

async function* sse(res: Response) {
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl: number;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const p = line.slice(5).trim();
      if (!p || p === '[DONE]') continue;
      try { const j = JSON.parse(p); if (typeof j.type === 'string') yield j; } catch { /* partial */ }
    }
  }
}

async function run(img: string, concept: string, extra: Record<string, unknown>) {
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'sam-3.1',
      input: [{ type: 'message', role: 'user', content: [
        { type: 'input_text', text: concept },
        { type: 'input_image', image_url: `data:image/png;base64,${img}` },
      ] }],
      metadata: { include_confidence: 'true' },
      stream: true,
      ...extra,
    }),
  });
  if (!res.ok) return `HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`;
  const stream = parseImageStream(sse(res));
  for await (const _s of stream) void _s;
  const r = await stream.finalResult;
  const masks = recordsOfKind(r.records, 'mask');
  const total = masks.reduce((a, m) => { let n = 0; try { for (const v of (m.mask.payload ? [] : [])) n += v; } catch { /* unused */ } return a + n; }, 0);
  void total;
  return `${masks.length} masks [${masks.map((m) => `${m.bounds.left},${m.bounds.top}-${m.bounds.right},${m.bounds.bottom}`).join(' ')}]`;
}

async function main() {
  const img = readFileSync('public/samples/sample-series-ok.png').toString('base64');
  for (const [label, extra] of [
    ['default      ', {}],
    ['temperature=0', { temperature: 0 }],
    ['temperature=0', { temperature: 0 }],
    ['temperature=0', { temperature: 0 }],
    ['default      ', {}],
  ] as const) {
    console.log(`${label}: ${await run(img, 'drawn wire line', extra)}`);
  }
}
void main();
