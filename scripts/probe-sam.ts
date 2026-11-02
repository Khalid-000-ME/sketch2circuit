/** Checks that the official parser turns a real SAM response into usable records. */
import { readFileSync } from 'node:fs';
import { decodeMaskToRaster, parseImageStream, recordsOfKind } from '@meta-sam/parser';

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

async function segment(img: string, concept: string) {
  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.SAM_MODEL ?? 'sam-3.1',
      input: [{ type: 'message', role: 'user', content: [
        { type: 'input_text', text: concept },
        { type: 'input_image', image_url: `data:image/png;base64,${img}` },
      ] }],
      metadata: { include_confidence: 'true', mask_encoding: 'lossless' },
      stream: true,
    }),
  });
  if (!res.ok) { console.log(`  ${concept}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`); return; }

  const stream = parseImageStream(sse(res));
  for await (const _s of stream) void _s;
  const result = await stream.finalResult;
  const boxes = recordsOfKind(result.records, 'box');
  const masks = recordsOfKind(result.records, 'mask');
  console.log(`  "${concept}": ${boxes.length} boxes, ${masks.length} masks, outcome=${result.outcome.status}, diagnostics=${result.diagnostics.length}`);
  for (const d of result.diagnostics.slice(0, 3)) console.log(`    diag ${d.code}: ${d.message}`);
  for (const m of masks.slice(0, 4)) {
    let px = 0;
    try {
      const raster = decodeMaskToRaster(m.mask);
      for (const v of raster) px += v;
      console.log(`    mask id=${m.objectId} ${m.mask.width}x${m.mask.height} enc=${m.mask.encoding} pixels=${px} bounds=${JSON.stringify(m.bounds)} conf=${m.confidence ?? '-'}`);
    } catch (e) {
      console.log(`    mask id=${m.objectId} DECODE FAILED: ${e}`);
    }
  }
  if (!masks.length && result.rawOutput) console.log(`    raw: ${result.rawOutput.slice(0, 200)}`);
}

async function main() {
  const img = readFileSync(`public/samples/${process.env.SAMPLE ?? 'sample-series-ok'}.png`).toString('base64');
  console.log(`phrasings on ${process.env.SAMPLE ?? 'sample-series-ok'}:`);
  const phrasings = process.env.CONCEPTS
    ? process.env.CONCEPTS.split('|')
    : ['battery symbol', 'battery', 'parallel lines battery symbol',
       'drawn battery cell symbol', 'pair of long and short parallel lines',
       'circuit diagram battery'];
  await Promise.all(phrasings.map((c) => segment(img, c)));
}
void main();
