'use client';

import type { Net, SpecConnection } from '@/lib/types';
import { specStatus } from '@/lib/circuit/spec';

interface Props {
  items: SpecConnection[];
  nets: Net[];
  /** Join two pins. The same handler the editor uses, so the result is solved at once. */
  onConnect: (a: string, b: string) => void;
}

/**
 * What the page says is connected, checked against what is.
 *
 * A written line is an explicit statement, so each one is kept and judged against
 * the circuit as it stands: drawn, read or edited by hand. Status is computed here
 * from the current nets, never stored, so the list stays true while the person
 * works. Each state has a mark and a word as well as a colour.
 */
export default function SpecPanel({ items, nets, onConnect }: Props) {
  if (items.length === 0) return null;
  const rows = items.map((item) => ({ item, status: specStatus(item, nets) }));
  const inCircuit = rows.filter((r) => r.status === 'satisfied').length;
  const complete = inCircuit === rows.length;

  return (
    <section
      aria-label="Connections written on the page"
      className={`rounded-lg border p-3.5 ${complete ? 'border-ok/30 bg-ok/[0.04]' : 'border-edge bg-raised'}`}
    >
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-[11px] uppercase tracking-wider text-faint">Written on your page</h3>
        <span className={`text-[12px] ${complete ? 'text-ok' : 'text-warn'}`}>
          {inCircuit} of {rows.length} in the circuit
        </span>
      </div>

      <ul className="mt-2.5 space-y-2">
        {rows.map(({ item, status }) => (
          <li key={item.id} className="flex items-start gap-2.5 text-[12px]">
            <span
              aria-hidden
              className={`mt-px flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border text-[10px] font-bold leading-none ${
                status === 'satisfied' ? 'border-ok/50 text-ok'
                : status === 'open' ? 'border-warn/50 text-warn'
                : 'border-error/50 text-error'
              }`}
            >
              {status === 'satisfied' ? '✓' : status === 'open' ? '+' : '!'}
            </span>

            <div className="min-w-0 flex-1">
              <p className="break-words font-mono text-ink">{item.text}</p>
              <p className="mt-0.5 break-all font-mono text-[11px] text-faint">{item.a} · {item.b}</p>
              {status === 'conflict' && (
                <p className="mt-1 leading-relaxed text-error">
                  Both ends are already joined to other things. Connecting them merges those.
                </p>
              )}
            </div>

            {status !== 'satisfied' && (
              <button
                type="button"
                onClick={() => onConnect(item.a, item.b)}
                className={`h-8 shrink-0 whitespace-nowrap rounded border px-2.5 text-[11px] transition ${
                  status === 'conflict'
                    ? 'border-error/40 text-error hover:bg-error/10'
                    : 'border-warn/40 text-warn hover:bg-warn/10'
                }`}
              >
                {status === 'conflict' ? 'Use the table' : 'Connect'}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
