'use client';

import { useEffect, useRef, useState } from 'react';
import { kindFromDef, makeComponent, PARTS, type PartKind } from '@/lib/circuit/edit';
import type { PartDef } from '@/lib/circuit/partdef';
import { STARTER_PARTS } from '@/fixtures/parts';
import { loadParts, saveParts, withPart } from '@/lib/parts-library';
import DescribePart from './DescribePart';
import { isBoardType } from '@/lib/circuit/boards';
import { symbolFor } from '@/schematic/symbols';

const GROUPS: Array<[PartKind['group'], string]> = [
  ['basic', 'Basic'],
  ['active', 'Loads and switching'],
  ['more', 'Transistors, relays and more'],
  ['board', 'Boards'],
];

const STARTER_KINDS = STARTER_PARTS.map((d) => kindFromDef(d, 'more'));

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
  const [describing, setDescribing] = useState(false);
  const [mine, setMine] = useState<PartDef[]>([]);
  const box = useRef<HTMLDivElement>(null);

  const useDescribed = (def: PartDef, keep: boolean) => {
    if (keep) {
      const next = withPart(mine, def);
      setMine(next);
      saveParts(next);
    }
    onAdd(kindFromDef(def, 'mine'));
    setDescribing(false);
    setOpen(false);
  };

  const forget = (name: string) => {
    const next = mine.filter((p) => p.name !== name);
    setMine(next);
    saveParts(next);
  };

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
        onClick={() => {
          // Saved parts live in this browser, so they are read when the palette opens.
          if (!open) setMine(loadParts());
          setOpen((v) => !v);
        }}
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
          <button
            type="button"
            role="menuitem"
            onClick={() => { setDescribing(true); setOpen(false); }}
            className="mb-1 flex w-full items-center justify-between rounded-md border border-accent/40 px-3 py-2 text-left text-[12px] text-accent transition hover:bg-accent/10"
          >
            <span>Describe a part…</span>
            <span className="text-[10px] text-dim">any part, in words</span>
          </button>
          {mine.length > 0 && (
            <div className="mb-1">
              <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-faint">My parts</p>
              <div className="grid grid-cols-2 gap-1">
                {mine.map((def) => (
                  <div key={def.name} className="group relative">
                    <button
                      type="button"
                      role="menuitem"
                      onClick={() => { onAdd(kindFromDef(def, 'mine')); setOpen(false); }}
                      className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[12px] text-dim transition hover:bg-white/[0.04] hover:text-ink"
                    >
                      <Preview kind={kindFromDef(def, 'mine')} />
                      <span className="leading-tight">{def.name}</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => forget(def.name)}
                      aria-label={`Remove ${def.name} from My parts`}
                      className="absolute right-1 top-1 hidden rounded px-1 text-[11px] text-faint hover:text-error group-hover:block focus:block"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
          {GROUPS.map(([group, title]) => (
            <div key={group} className="mb-1">
              <p className="px-2 pb-1 pt-2 text-[10px] uppercase tracking-wider text-faint">{title}</p>
              <div className="grid grid-cols-2 gap-1">
                {[...PARTS, ...STARTER_KINDS].filter((p) => p.group === group).map((kind) => (
                  <button
                    key={kind.custom?.name ?? kind.type}
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
      {describing && <DescribePart onClose={() => setDescribing(false)} onUse={useDescribed} />}
    </div>
  );
}
