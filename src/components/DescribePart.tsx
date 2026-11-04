'use client';

import { useEffect, useRef, useState } from 'react';
import { kindFromDef, makeComponent } from '@/lib/circuit/edit';
import type { PartDef } from '@/lib/circuit/partdef';
import type { CheckResult } from '@/lib/circuit/part-checks';
import { symbolFor } from '@/schematic/symbols';

interface PartReply {
  buildable: boolean;
  reason: string;
  part: PartDef | null;
  checks: CheckResult[];
  verified: boolean;
  attempts: number;
  problems: string[];
}

const EXAMPLES = [
  'A 12V automotive relay with a normally closed contact',
  'A 3.3V LDO regulator',
  'A 2N7000 N-channel MOSFET',
  'A 6V solid state relay that switches on at 3V',
];

const FIDELITY: Record<PartDef['fidelity'], string> = {
  full: 'Steady-state behaviour is all it does',
  dc_only: 'DC behaviour only',
  approximate: 'Approximate model',
};

function SymbolPreview({ def }: { def: PartDef }) {
  const part = { ...makeComponent([], kindFromDef(def)), id: def.prefix };
  const sym = symbolFor(part);
  const [hx, hy] = sym.half;
  return (
    <svg viewBox={`${-hx - 8} ${-hy - 10} ${hx * 2 + 16} ${hy * 2 + 20}`} className="h-24 w-full max-w-[16rem]" aria-hidden>
      <g className="symbol">{sym.draw(part)}</g>
    </svg>
  );
}

/**
 * Describe a part in words, get a part. The model proposes it; the solver is what
 * decides whether it behaves as described, and what it measured is shown here.
 */
export default function DescribePart({
  onClose,
  onUse,
}: {
  onClose: () => void;
  onUse: (def: PartDef, save: boolean) => void;
}) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState<PartReply | null>(null);
  const [save, setSave] = useState(true);
  const abort = useRef<AbortController | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    area.current?.focus();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => { window.removeEventListener('keydown', onKey); abort.current?.abort(); };
  }, [onClose]);

  useEffect(() => {
    if (!busy) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [busy]);

  async function make() {
    if (busy || text.trim().length < 3) return;
    setBusy(true); setElapsed(0); setError(null); setReply(null);
    const controller = new AbortController();
    abort.current = controller;
    try {
      const res = await fetch('/api/part', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: text }),
        signal: controller.signal,
      });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new Error(body?.error ?? 'That part could not be made. Try again.');
      setReply(body as PartReply);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const def = reply?.part ?? null;

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onPointerDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-labelledby="describe-title" className="w-full max-w-xl rounded-xl border border-edge-strong bg-panel p-5 shadow-2xl">
        <div className="mb-3 flex items-start justify-between gap-4">
          <div>
            <h2 id="describe-title" className="text-[15px] font-medium text-ink">Describe a part</h2>
            <p className="mt-0.5 text-[12px] text-dim">Say what it is and what it does. It is built from the same device models the simulator uses, then checked.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded px-2 py-1 text-dim hover:text-ink" aria-label="Close">✕</button>
        </div>

        <label htmlFor="part-text" className="sr-only">Part description</label>
        <textarea
          id="part-text"
          ref={area}
          value={text}
          onChange={(e) => setText(e.target.value.slice(0, 600))}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) void make(); }}
          rows={3}
          placeholder="A 5V relay with one normally open contact rated 10A"
          className="w-full resize-none rounded-md border border-edge bg-bg px-3 py-2 text-[13px] text-ink placeholder:text-faint focus:border-accent/60 focus:outline-none"
        />
        <div className="mt-2 flex flex-wrap gap-1.5">
          {EXAMPLES.map((ex) => (
            <button key={ex} type="button" onClick={() => setText(ex)} className="rounded-full border border-edge px-2.5 py-1 text-[11px] text-dim transition hover:border-accent/50 hover:text-ink">
              {ex}
            </button>
          ))}
        </div>

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void make()}
            disabled={busy || text.trim().length < 3}
            className="h-9 rounded-md bg-accent px-4 text-[13px] font-medium text-bg transition enabled:hover:brightness-110 disabled:opacity-40"
          >
            {busy ? 'Making…' : 'Make part'}
          </button>
          {busy && (
            <>
              <span className="text-[12px] text-dim" aria-live="polite">{elapsed}s. Usually under a minute, up to three when it has to correct itself.</span>
              <button type="button" onClick={() => abort.current?.abort()} className="text-[12px] text-faint underline-offset-2 hover:text-ink hover:underline">Cancel</button>
            </>
          )}
        </div>

        {error && <p role="alert" className="mt-3 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">{error}</p>}

        {reply && !reply.buildable && (
          <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
            This cannot be built as a DC part. {reply.reason}
          </p>
        )}

        {reply && reply.buildable && !def && (
          <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
            A usable definition did not come back after {reply.attempts} attempt{reply.attempts === 1 ? '' : 's'}.
            {reply.problems.length > 0 && ` Last problem: ${reply.problems[0]}`} Try describing it more specifically.
          </p>
        )}

        {def && reply && (
          <div className="mt-4 border-t border-edge pt-4">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-[14px] font-medium text-ink">{def.name}</h3>
              <span className={`rounded-full border px-2 py-0.5 text-[10px] ${reply.verified ? 'border-ok/50 text-ok' : 'border-warn/50 text-warn'}`}>
                {reply.verified ? 'Passed its own checks' : 'Failed a check'}
              </span>
              <span className="rounded-full border border-edge px-2 py-0.5 text-[10px] text-dim">{FIDELITY[def.fidelity]}</span>
            </div>
            <p className="mt-1 text-[12px] text-dim">{def.summary}</p>

            <div className="mt-3 flex flex-col items-start gap-3 sm:flex-row sm:items-center">
              <SymbolPreview def={def} />
              <p className="text-[12px] text-dim">
                Pins: <span className="font-mono text-ink">{def.pins.map((p) => p.label).join('  ')}</span>
                <br />Built from: <span className="font-mono text-ink">{[...new Set(def.elements.map((e) => e.kind))].join(', ')}</span>
              </p>
            </div>

            <p className="mb-1 mt-3 text-[10px] uppercase tracking-wider text-faint">What the solver measured</p>
            <ul className="space-y-1.5">
              {reply.checks.map((c) => (
                <li key={c.say} className="text-[12px]">
                  <span className={c.pass ? 'text-ok' : 'text-error'}>{c.pass ? '✓' : '✗'}</span>{' '}
                  <span className="text-ink">{c.say}</span>
                  {!c.pass && c.detail.map((d) => <span key={d} className="mt-0.5 block pl-4 font-mono text-[11px] text-dim">{d}</span>)}
                </li>
              ))}
            </ul>

            {(def.assumptions.length > 0 || def.limits.length > 0) && (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {def.assumptions.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-faint">It assumes</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-dim">{def.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
                  </div>
                )}
                {def.limits.length > 0 && (
                  <div>
                    <p className="mb-1 text-[10px] uppercase tracking-wider text-faint">It does not model</p>
                    <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-dim">{def.limits.map((a) => <li key={a}>{a}</li>)}</ul>
                  </div>
                )}
              </div>
            )}

            {def.ratings.length > 0 && (
              <p className="mt-3 text-[12px] text-dim">
                Warns you past: {def.ratings.map((r) => r.label).join('; ')}.
              </p>
            )}

            <p className="mt-3 text-[11px] text-faint">
              The checks come from the same model that wrote the part, so read them: they show what it is
              assumed to do, and the solver confirms the circuit behaves that way.
            </p>

            {!reply.verified && (
              <p className="mt-3 rounded-md border border-warn/40 bg-warn/10 px-3 py-2 text-[12px] text-warn">
                This part did not pass every check after {reply.attempts} attempt{reply.attempts === 1 ? '' : 's'}. Its readings may not match the real part. Try again with more detail, or add it knowing that.
              </p>
            )}

            <div className="mt-4 flex flex-wrap items-center gap-3">
              <button
                type="button"
                onClick={() => onUse(def, save)}
                className={`h-9 rounded-md px-4 text-[13px] font-medium transition hover:brightness-110 ${reply.verified ? 'bg-accent text-bg' : 'border border-warn/60 text-warn'}`}
              >
                {reply.verified ? 'Add to circuit' : 'Add anyway'}
              </button>
              <label className="flex items-center gap-2 text-[12px] text-dim">
                <input type="checkbox" checked={save} onChange={(e) => setSave(e.target.checked)} />
                Keep in My parts
              </label>
              <button type="button" onClick={() => void make()} className="ml-auto text-[12px] text-dim underline-offset-2 hover:text-ink hover:underline">Make it again</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
