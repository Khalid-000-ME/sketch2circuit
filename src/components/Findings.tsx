'use client';

import type { Finding, Severity } from '@/lib/types';

/**
 * The findings list. This is the product, so it gets the most careful typography
 * on the page: the consequence in full, the fix immediately under it, and the
 * component reference as a jump target.
 *
 * Severity is carried by an icon and a word as well as a colour (NFR-10), so the
 * list is readable without colour vision.
 */

const SEVERITY: Record<Severity, { label: string; icon: string; className: string; dot: string }> = {
  error: { label: 'Error', icon: '✕', className: 'text-error border-error/40 bg-error/[0.07]', dot: 'bg-error' },
  warning: { label: 'Warning', icon: '!', className: 'text-warn border-warn/40 bg-warn/[0.07]', dot: 'bg-warn' },
  info: { label: 'Note', icon: 'i', className: 'text-info border-info/35 bg-info/[0.06]', dot: 'bg-info' },
};

interface Props {
  findings: Finding[];
  selectedId: string | null;
  onSelect: (componentId: string) => void;
}

export default function Findings({ findings, selectedId, onSelect }: Props) {
  if (findings.length === 0) {
    return (
      <div className="rounded-lg border border-ok/30 bg-ok/[0.06] p-4">
        <div className="flex items-center gap-2.5">
          <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-ok/20 text-[11px] font-bold text-ok">✓</span>
          <h3 className="text-sm font-medium text-ok">Nothing to flag</h3>
        </div>
        <p className="mt-2 text-[13px] leading-relaxed text-dim">
          Every check passed. Component currents, voltages and power are within the ratings of
          standard through-hole parts.
        </p>
      </div>
    );
  }

  const counts = findings.reduce<Record<string, number>>((acc, f) => {
    acc[f.severity] = (acc[f.severity] ?? 0) + 1;
    return acc;
  }, {});

  return (
    <div className="space-y-2.5">
      <div className="flex items-center gap-3 text-[11px] uppercase tracking-wider text-faint">
        <span>Findings</span>
        <div className="flex gap-2">
          {(['error', 'warning', 'info'] as Severity[]).map((s) => (
            counts[s] ? (
              <span key={s} className="flex items-center gap-1.5 normal-case tracking-normal">
                <span className={`h-1.5 w-1.5 rounded-full ${SEVERITY[s].dot}`} aria-hidden />
                <span className="text-dim">{counts[s]} {SEVERITY[s].label.toLowerCase()}{counts[s] > 1 ? 's' : ''}</span>
              </span>
            ) : null
          ))}
        </div>
      </div>

      <ul className="space-y-2.5">
        {findings.map((f) => {
          const meta = SEVERITY[f.severity];
          const active = f.component_id != null && f.component_id === selectedId;
          const Tag = f.component_id ? 'button' : 'div';
          return (
            <li key={f.id} className="fade-up">
              <Tag
                {...(f.component_id
                  ? { type: 'button' as const, onClick: () => onSelect(f.component_id!) }
                  : {})}
                className={`w-full rounded-lg border p-3.5 text-left transition ${meta.className} ${
                  f.component_id ? 'cursor-pointer hover:brightness-125' : ''
                } ${active ? 'ring-1 ring-accent/70' : ''}`}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-full border border-current text-[10px] font-bold leading-none`}
                    aria-hidden
                  >
                    {meta.icon}
                  </span>
                  <span className="text-[11px] font-semibold uppercase tracking-wider">{meta.label}</span>
                  {f.component_id && (
                    <span className="ml-auto rounded bg-black/30 px-1.5 py-0.5 font-mono text-[11px] text-ink/80">
                      {f.component_id}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-ink">{f.message}</p>
                <p className="mt-2 flex gap-1.5 text-[13px] leading-relaxed text-dim">
                  <span className="shrink-0 font-medium text-ink/70">Fix:</span>
                  <span>{f.fix}</span>
                </p>
              </Tag>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
