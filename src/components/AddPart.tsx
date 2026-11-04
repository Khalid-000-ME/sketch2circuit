'use client';

import { useEffect, useRef, useState } from 'react';
import { makeComponent, PARTS, type PartKind } from '@/lib/circuit/edit';
import { isBoardType } from '@/lib/circuit/boards';
import { symbolFor } from '@/schematic/symbols';

const GROUPS: Array<[PartKind['group'], string]> = [
  ['basic', 'Basic'],
  ['active', 'Loads and switching'],
  ['board', 'Boards'],
];

/** The part drawn as it will appear on the page, so it can be recognised before it is placed. */
function Preview({ kind }: { kind: PartKind }) {
  if (isBoardType(kind.type)) {
    return (
      <span className="flex h-9 w-14 items-center justify-center rounded border border-edge-strong bg-[#101722] font-mono text-[9px] tracking-wider text-dim">
        {kind.type === 'arduino_uno' ? 'UNO' : 'PI'}
      </span>
    );
  }
  const part = makeComponent([], kind);
  const def = symbolFor(part);
  const [hx, hy] = def.half;
  return (
    <svg viewBox={`${-hx - 6} ${-hy - 8} ${hx * 2 + 12} ${hy * 2 + 16}`} className="h-9 w-14" aria-hidden>
      <g className="symbol">{def.draw(part)}</g>
    </svg>
  );
}

/**
 * The part palette: a button, and a panel of everything that can be added.
 * Dismisses on Escape or a click anywhere else, like any menu.
 */
export default function AddPart({ onAdd }: { onAdd: (kind: PartKind) => void }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={box} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="h-9 whitespace-nowrap rounded-md border border-edge px-3 text-[13px] text-dim transition hover:border-accent/50 hover:text-ink"
      >
        Add part
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-11 z-30 max-h-[70vh] w-[19rem] overflow-y-auto rounded-lg border border-edge-strong bg-panel p-2 shadow-2xl"
        >
          {GROUPS.map(([group, title]) => (
            <div key={group} className="mb-1">
              <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-faint">{title}</p>
              <div className="grid grid-cols-2 gap-1">
                {PARTS.filter((p) => p.group === group).map((kind) => (
                  <button
                    key={kind.type}
                    type="button"
                    role="menuitem"
                    onClick={() => { onAdd(kind); setOpen(false); }}
                    className="flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-dim transition hover:bg-white/[0.04] hover:text-ink"
                  >
                    <Preview kind={kind} />
                    <span className="leading-tight">{kind.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
