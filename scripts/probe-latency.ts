/** How long is the page read taking right now? Times Spark directly. */
import { readFileSync } from 'node:fs';
const BASE = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';

async function timed(label: string, effort: string, img: string) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: 'muse-spark-1.3',
      reasoning_effort: effort,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: 'Name each component symbol you can see. JSON only: {"c":["type",...]}' },
          { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
        ],
      }],
    }),
  });
  const ms = Date.now() - t0;
  if (!res.ok) { console.log(`${label}: HTTP ${res.status} after ${(ms / 1000).toFixed(1)}s`); return; }
  const j = await res.json();
  const u = j.usage ?? {};
  console.log(`${label}: ${(ms / 1000).toFixed(1)}s  reasoning_tokens=${u.completion_tokens_details?.reasoning_tokens ?? '?'}  -> ${(j.choices?.[0]?.message?.content ?? '').slice(0, 80)}`);
}

async function main() {
  const img = readFileSync('public/samples/sample-series-ok.png').toString('base64');
  for (const effort of ['high', 'high', 'low']) await timed(`effort=${effort}`, effort, img);
}
void main();
