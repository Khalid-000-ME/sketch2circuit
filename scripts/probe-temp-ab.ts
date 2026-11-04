/** Did pinning temperature change how long the real page prompt takes? */
import { readFileSync } from 'node:fs';
const BASE = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';

async function run(label: string, body: Record<string, unknown>) {
  const t0 = Date.now();
  const res = await fetch(`${BASE}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.MODEL_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const ms = Date.now() - t0;
  if (!res.ok) { console.log(`${label}: HTTP ${res.status} after ${(ms / 1000).toFixed(1)}s`); return; }
  const j = await res.json();
  const r = j.usage?.completion_tokens_details?.reasoning_tokens ?? '?';
  console.log(`${label}: ${(ms / 1000).toFixed(1)}s  reasoning=${r}`);
}

async function main() {
  const img = readFileSync('public/samples/sample-parallel-switch.png').toString('base64');
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: 'Identify every component symbol and its handwritten value. JSON only.' },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
    ],
  }];
  const base = { model: 'muse-spark-1.3', reasoning_effort: 'high', messages };
  await run('no temperature ', base);
  await run('temperature = 0', { ...base, temperature: 0 });
  await run('no temperature ', base);
  await run('temperature = 0', { ...base, temperature: 0 });
}
void main();
