/**
 * Meta Model API transport.
 *
 * One place that knows the base URL, the key and the wire format, so `sam.ts` and
 * `spark.ts` only deal in their own domains. The key is read lazily rather than at
 * module load, so a missing key surfaces as a clean 500 with a useful message
 * instead of crashing the route at import time.
 */

import { HttpError } from '../types';

export const META_BASE_URL = process.env.META_BASE_URL ?? 'https://api.meta.ai/v1';

/** Reasoning model: text + image + video + PDF, 1M context, JSON-schema output. */
export const SPARK_MODEL = process.env.SPARK_MODEL ?? 'muse-spark-1.3';
/** Segmentation model: noun-phrase, box or point prompts; boxes + masks out. */
export const SAM_MODEL = process.env.SAM_MODEL ?? 'sam-3.1';

export function apiKey(): string {
  const key = process.env.MODEL_API_KEY;
  if (!key) {
    throw new HttpError(
      500,
      'The server is missing its Meta Model API key, so live analysis is unavailable. The bundled sample circuits still work.',
      'MODEL_API_KEY is not set',
    );
  }
  return key;
}

export function hasApiKey(): boolean {
  return Boolean(process.env.MODEL_API_KEY);
}

export interface MetaRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

/** Maps a transport or upstream failure onto the user-facing error table in §7.3. */
function mapUpstream(status: number, body: string): HttpError {
  if (status === 429) return new HttpError(429, 'Too many requests right now. Try again in a moment.', body);
  if (status === 401 || status === 403) {
    return new HttpError(500, 'The Meta Model API rejected our credentials. Check the server key.', body);
  }
  if (status === 413) return new HttpError(413, 'That image is too large. Try one under 10MB.', body);
  return new HttpError(500, 'Something went wrong analysing that. Try again.', `upstream ${status}: ${body.slice(0, 400)}`);
}

async function post(path: string, body: unknown, opts: MetaRequestOptions = {}): Promise<Response> {
  const controller = new AbortController();
  // Every caller passes its own ceiling; this is the backstop. It is generous
  // because the Model API's latency has a long tail and a late answer beats none.
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 90_000);
  if (opts.signal) opts.signal.addEventListener('abort', () => controller.abort(), { once: true });
  try {
    const res = await fetch(`${META_BASE_URL}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    if (!res.ok) throw mapUpstream(res.status, await res.text().catch(() => ''));
    return res;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if (err instanceof Error && err.name === 'AbortError') {
      throw new HttpError(504, 'That took too long. Try a simpler sketch or a clearer photo.', 'upstream timeout');
    }
    throw new HttpError(500, 'Something went wrong analysing that. Try again.', String(err));
  } finally {
    clearTimeout(timeout);
  }
}

export async function postJson<T>(path: string, body: unknown, opts?: MetaRequestOptions): Promise<T> {
  const res = await post(path, body, opts);
  return (await res.json()) as T;
}

export async function postStream(path: string, body: unknown, opts?: MetaRequestOptions): Promise<Response> {
  return post(path, { ...(body as object), stream: true }, opts);
}

/** No chunk for this long means the stream has stalled. */
const STREAM_IDLE_MS = 30_000;
/** A whole stream may not take longer than this, however steadily it trickles. */
const STREAM_TOTAL_MS = 120_000;

/** Resolves to the sentinel if `ms` passes first. Clears its own timer. */
function withDeadline<T>(promise: Promise<T>, ms: number, sentinel: symbol): Promise<T | symbol> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<symbol>((resolve) => { timer = setTimeout(() => resolve(sentinel), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

const STALLED = Symbol('stream-stalled');

/**
 * Turns an SSE body into the async iterable of decoded events that
 * `@meta-sam/parser` consumes.
 *
 * The read is bounded in two ways, because the request timeout cannot help here:
 * it is cleared the moment the response headers arrive, and everything expensive
 * happens afterwards. Without these a stalled stream hangs the request
 * indefinitely — one measured at twenty-seven minutes before this existed.
 */
export async function* sseEvents(res: Response): AsyncGenerator<{ type: string } & Record<string, unknown>> {
  const body = res.body;
  if (!body) throw new HttpError(500, 'Something went wrong analysing that. Try again.', 'empty stream body');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  const startedAt = Date.now();
  let buffer = '';
  try {
    for (;;) {
      const next = await withDeadline(reader.read(), STREAM_IDLE_MS, STALLED);
      if (next === STALLED) {
        await reader.cancel().catch(() => {});
        throw new HttpError(504, 'That took too long. Try a simpler sketch or a clearer photo.', 'segmentation stream stalled');
      }
      if (Date.now() - startedAt > STREAM_TOTAL_MS) {
        await reader.cancel().catch(() => {});
        throw new HttpError(504, 'That took too long. Try a simpler sketch or a clearer photo.', 'segmentation stream exceeded its budget');
      }
      const { done, value } = next as ReadableStreamReadResult<Uint8Array>;
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let nl: number;
      // Events are separated by a blank line; fields we care about are `data:`.
      while ((nl = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, '');
        buffer = buffer.slice(nl + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed && typeof parsed.type === 'string') yield parsed;
        } catch {
          // A partial frame; the next chunk completes it.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}
