/**
 * Material classes, one per physical substance.
 *
 * Quality in this renderer comes from materials and light, not polygon count, so
 * these definitions carry more of the result than the geometry does. Every
 * material is MeshPhysicalMaterial and every one is shared across all instances
 * of its substance, which keeps draw calls and GPU state changes down.
 */

import * as THREE from 'three';

const cache = new Map<string, THREE.MeshPhysicalMaterial>();

function make(key: string, params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial {
  const hit = cache.get(key);
  if (hit) return hit;
  const m = new THREE.MeshPhysicalMaterial(params);
  cache.set(key, m);
  return m;
}

/** Ceramic: resistor and capacitor bodies. Matte, with the faintest glaze. */
export const ceramic = (color: THREE.ColorRepresentation) =>
  make(`ceramic:${String(color)}`, { color, roughness: 0.7, metalness: 0, clearcoat: 0.2, clearcoatRoughness: 0.6 });

/** Epoxy: the LED dome. Transmissive, so it picks up the environment and glows. */
export const epoxy = (color: THREE.ColorRepresentation, emissiveIntensity = 0) =>
  make(`epoxy:${String(color)}:${emissiveIntensity}`, {
    color, roughness: 0.05, metalness: 0, transmission: 0.9, ior: 1.5, thickness: 2,
    emissive: new THREE.Color(color), emissiveIntensity,
  });

/** Tinned copper: every lead, every terminal. */
export const lead = () => make('lead', { color: 0xd8dce0, roughness: 0.25, metalness: 1 });

/** Moulded plastic: IC bodies, switch housings. */
export const plastic = (color: THREE.ColorRepresentation) =>
  make(`plastic:${String(color)}`, { color, roughness: 0.45, metalness: 0, clearcoat: 0.3 });

/** FR4 with solder mask: the board itself. Dark, so the parts read against it. */
export const fr4 = () => make('fr4', {
  color: 0x0b3522, roughness: 0.52, metalness: 0, clearcoat: 0.35, clearcoatRoughness: 0.55,
});

/** The gold-plated edge of the board. */
export const boardEdge = () => make('boardEdge', { color: 0x1a1d1c, roughness: 0.7, metalness: 0.2 });

/** Painted metal: battery shells. */
export const paintedMetal = (color: THREE.ColorRepresentation) =>
  make(`paint:${String(color)}`, { color, roughness: 0.35, metalness: 0.6, clearcoat: 0.5 });

/** Insulated wire sheath. */
export const sheath = (color: THREE.ColorRepresentation) =>
  make(`sheath:${String(color)}`, { color, roughness: 0.4, metalness: 0, clearcoat: 0.25 });

/** Bare copper, for the small pads a wire lands on. */
export const copper = () => make('copper', { color: 0xb87333, roughness: 0.35, metalness: 1 });

/** Back-face shell used for the selection outline — cheaper than a composer pass. */
export const outline = (color: THREE.ColorRepresentation) =>
  make(`outline:${String(color)}`, {
    color, roughness: 1, metalness: 0, side: THREE.BackSide,
    transparent: true, opacity: 0.95, depthWrite: false,
  });

/** The palette the renderer draws from, so colour decisions live in one place. */
export const PALETTE = {
  board: 0x0b3522,
  wirePositive: 0xd23b3b,
  wireGround: 0x2b2f36,
  wireSignal: 0x3f7fd6,
  fault: 0xff4d4d,
  warn: 0xffb020,
  ok: 0x46d6a0,
  select: 0x6ee7ff,
  resistorBody: 0xc8ac7a,
  ledLeadLong: 0xd8dce0,
} as const;

/** E24 band colours, keyed by digit. Bands are computed from the value, never authored. */
export const BAND_COLOURS: Record<number, number> = {
  0: 0x1a1a1a, 1: 0x6b4423, 2: 0xc62828, 3: 0xef6c00, 4: 0xf9a825,
  5: 0x2e7d32, 6: 0x1565c0, 7: 0x6a1b9a, 8: 0x757575, 9: 0xeeeeee,
};
export const GOLD = 0xc9a227;
export const SILVER = 0xb0b0b0;

/**
 * Turns a resistance into its four band colours.
 * 220 -> red, red, brown, gold. This is the detail that makes the rest believable.
 */
export function resistorBands(ohms: number | null): number[] {
  if (ohms == null || !Number.isFinite(ohms) || ohms <= 0) {
    return [BAND_COLOURS[8], BAND_COLOURS[8], BAND_COLOURS[8], SILVER];
  }
  let exponent = 0;
  let significant = ohms;
  while (significant >= 100) { significant /= 10; exponent++; }
  while (significant < 10 && significant > 0) { significant *= 10; exponent--; }
  const rounded = Math.round(significant);
  const d1 = Math.floor(rounded / 10) % 10;
  const d2 = rounded % 10;
  const mult = Math.max(0, Math.min(9, exponent));
  return [BAND_COLOURS[d1], BAND_COLOURS[d2], BAND_COLOURS[mult], GOLD];
}

export function disposeMaterials() {
  for (const m of cache.values()) m.dispose();
  cache.clear();
}
