'use client';

import type { Confidence } from '@/lib/types';

/**
 * Per-stage confidence (US-06, FR-2.5).
 *
 * Shown always, not only when something is wrong: a number that appears only on
 * failure teaches people to ignore it. Below 0.85 the bar is marked, because that
 * is the threshold at which the findings deserve a second look.
 */

const STAGES: Array<{ key: keyof Confidence; label: string; hint: string }> = [
  { key: 'components', label: 'Components', hint: 'How sure the vision stage is about which symbols these are.' },
  { key: 'connectivity', label: 'Connectivity', hint: 'How sure it is about which lead connects to which.' },
  { key: 'values', label: 'Values', hint: 'How sure it is about the handwritten numbers.' },
];

export default function StageStatus({ confidence, traced }: { confidence: Confidence; traced?: boolean }) {
  return (
    <div className="rounded-lg border border-edge bg-raised p-3.5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-[11px] uppercase tracking-wider text-faint">Confidence</h3>
        {traced != null && (
          <span className="text-[11px] text-faint" title={traced
            ? 'Connectivity came from walking the segmented wire mask — deterministic, not inferred.'
            : 'The wire mask did not resolve cleanly, so connectivity came from the model.'}>
            {traced ? 'traced from wire mask' : 'inferred by model'}
          </span>
        )}
      </div>
      <dl className="mt-2.5 space-y-2">
        {STAGES.map(({ key, label, hint }) => {
          const value = confidence[key] ?? 0;
          const low = value < 0.85;
          return (
            <div key={key} title={hint}>
              <div className="flex items-baseline justify-between text-[12px]">
                <dt className="text-dim">{label}</dt>
                <dd className={`font-mono ${low ? 'text-warn' : 'text-ok'}`}>
                  {low && <span aria-hidden className="mr-1">!</span>}
                  {value.toFixed(2)}
                </dd>
              </div>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-black/40">
                <div
                  className={`h-full rounded-full ${low ? 'bg-warn' : 'bg-ok'}`}
                  style={{ width: `${Math.round(Math.max(0.03, value) * 100)}%` }}
                />
              </div>
            </div>
          );
        })}
      </dl>
    </div>
  );
}
