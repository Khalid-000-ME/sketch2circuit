/** Is Muse Spark's page read reproducible? Boxes drive the whole trace. */
import { readFileSync } from 'node:fs';
const BASE = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';

async function read(img: string, extra: Record<string, unknown>) {
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'muse-spark-1.3',
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'List each component symbol with a tight bounding box in thousandths of the image as [x,y,w,h]. JSON only: {"c":[{"id":"","type":"","bbox":[0,0,0,0]}]}' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
        ],
      }],
      ...extra,
    }),
  });
  if (!res.ok) return `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
  const j = await res.json();
  return (j.choices?.[0]?.message?.content ?? '').replace(/\s+/g, '');
}

async function main() {
  const img = readFileSync('public/samples/sample-series-ok.png').toString('base64');
  for (const [label, extra] of [
    ['temp=0 #1', { temperature: 0 }],
    ['temp=0 #2', { temperature: 0 }],
    ['temp=0 #3', { temperature: 0 }],
    ['default   ', {}],
  ] as const) {
    console.log(`${label}: ${(await read(img, extra)).slice(0, 220)}`);
  }
}
void main();
