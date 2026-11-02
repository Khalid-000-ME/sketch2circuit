/**
 * Direct probe of both Meta Model API surfaces, independent of the app.
 * Prints raw responses so wire-format mismatches are obvious.
 * Run: npx tsx --env-file=.env.local scripts/probe-api.ts
 */
const BASE = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';
const KEY = process.env.MODEL_API_KEY;

async function post(path: string, body: unknown) {
  const res = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return res;
}

async function main() {
  if (!KEY) { console.log('NO KEY'); return; }
  console.log(`key length ${KEY.length}, prefix ${KEY.slice(0, 4)}…, base ${BASE}\n`);

  // 1. Spark, plain text — does auth work at all?
  console.log('=== 1. muse-spark chat/completions (text) ===');
  const r1 = await post('/chat/completions', {
    model: process.env.SPARK_MODEL ?? 'muse-spark-1.3',
    messages: [{ role: 'user', content: 'Reply with exactly: OK' }],
  });
  console.log('status', r1.status);
  const t1 = await r1.text();
  console.log(t1.slice(0, 900), '\n');

  // 2. Spark, structured output with an image.
  console.log('=== 2. muse-spark with image + json_schema ===');
  const { readFileSync } = await import('node:fs');
  const img = readFileSync('public/samples/sample-led-no-resistor.png').toString('base64');
  const r2 = await post('/chat/completions', {
    model: process.env.SPARK_MODEL ?? 'muse-spark-1.3',
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: 'List the electronic component symbols you can see. Return JSON {"components":[{"type":"...","value":"..."}]}' },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${img}` } },
      ],
    }],
    response_format: {
      type: 'json_schema',
      json_schema: {
        name: 'parts',
        schema: {
          type: 'object',
          properties: { components: { type: 'array', items: { type: 'object', properties: { type: { type: 'string' }, value: { type: ['string', 'null'] } } } } },
          required: ['components'],
        },
        strict: false,
      },
    },
  });
  console.log('status', r2.status);
  console.log((await r2.text()).slice(0, 1400), '\n');

  // 3. SAM 3.1 segmentation, streaming.
  console.log('=== 3. sam-3.1 /responses (streaming) ===');
  const r3 = await post('/responses', {
    model: process.env.SAM_MODEL ?? 'sam-3.1',
    input: [{
      type: 'message',
      role: 'user',
      content: [
        { type: 'input_text', text: 'drawn wire line' },
        { type: 'input_image', image_url: `data:image/png;base64,${img}` },
      ],
    }],
    metadata: { include_confidence: 'true', mask_encoding: 'lossless' },
    stream: true,
  });
  console.log('status', r3.status, 'content-type', r3.headers.get('content-type'));
  const raw = await r3.text();
  console.log('--- first 1600 chars of stream ---');
  console.log(raw.slice(0, 1600));
  console.log(`--- total ${raw.length} chars ---`);
}
void main();
