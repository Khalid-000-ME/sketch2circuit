/** Does SAM refine an approximate box into an exact mask? Tests the box-prompt path. */
import { readFileSync } from 'node:fs';
import { buildObjectPrompt, decodeMaskToRaster, parseImageStream, recordsOfKind } from '@meta-sam/parser';

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

async function main() {
  const img = readFileSync('public/samples/sample-series-ok.png').toString('base64');
  // The generated sketch is 1400x1000; the battery sits near (264..336, 500..580).
  const size = { width: 1400, height: 1000 };
  const prompt = buildObjectPrompt({
    size,
    objects: [
      { id: 0, prompts: [{ box: { left: 240, top: 480, right: 360, bottom: 600 } }] },   // battery
      { id: 1, prompts: [{ box: { left: 730, top: 255, right: 910, bottom: 345 } }] },   // resistor
      { id: 2, prompts: [{ points: [{ x: 300, y: 540, label: 'positive' }] }] },         // battery by point
    ],
  });
  console.log('object prompt text:\n' + prompt + '\n');

  const res = await fetch(`${BASE}/responses`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: process.env.SAM_MODEL ?? 'sam-3.1',
      input: [{ type: 'message', role: 'user', content: [
        { type: 'input_text', text: prompt },
        { type: 'input_image', image_url: `data:image/png;base64,${img}` },
      ] }],
      metadata: { include_confidence: 'true' },
      stream: true,
    }),
  });
  console.log('status', res.status);
  if (!res.ok) { console.log((await res.text()).slice(0, 600)); return; }

  const stream = parseImageStream(sse(res));
  for await (const _s of stream) void _s;
  const result = await stream.finalResult;
  console.log(`boxes=${recordsOfKind(result.records, 'box').length} masks=${recordsOfKind(result.records, 'mask').length} outcome=${result.outcome.status}`);
  for (const d of result.diagnostics) console.log(`  diag ${d.code}: ${d.message}`);
  for (const m of recordsOfKind(result.records, 'mask')) {
    let px = 0;
    const raster = decodeMaskToRaster(m.mask);
    for (const v of raster) px += v;
    console.log(`  id=${m.objectId} ${m.mask.width}x${m.mask.height} enc=${m.mask.encoding} px=${px} bounds=${JSON.stringify(m.bounds)} conf=${m.confidence ?? '-'}`);
  }
  if (!recordsOfKind(result.records, 'mask').length) console.log('raw:', result.rawOutput.slice(0, 400));
}
void main();
