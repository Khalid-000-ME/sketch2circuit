/**
 * The parts a person has described, kept in this browser.
 *
 * Whatever is read back is validated again, so a hand-edited or stale entry is
 * dropped instead of reaching the solver. Every access is guarded: storage can be
 * blocked, full or absent, and the app has to work without it.
 */

import { validatePart, type PartDef } from './circuit/partdef';

const KEY = 'sketchit.parts.v1';
const MAX_PARTS = 40;

export function loadParts(): PartDef[] {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const list = JSON.parse(raw) as unknown;
    if (!Array.isArray(list)) return [];
    return list.flatMap((item) => {
      const v = validatePart(item);
      return v.ok && v.def ? [v.def] : [];
    });
  } catch {
    return [];
  }
}

export function saveParts(parts: PartDef[]): boolean {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(parts.slice(0, MAX_PARTS)));
    return true;
  } catch {
    return false;
  }
}

/** Adds a part, replacing one of the same name, newest first. */
export function withPart(parts: PartDef[], def: PartDef): PartDef[] {
  return [def, ...parts.filter((p) => p.name !== def.name)].slice(0, MAX_PARTS);
}
