/**
 * The ink layer: every stroke on the page, as a binary raster.
 *
 * This exists because of a measured failure. Connectivity used to be traced from
 * SAM's "drawn wire line" masks, and SAM's recall on thin pencil lines is not
 * dependable: on one bundled sketch it returned the lower wire run and missed the
 * upper one entirely, under every phrasing tried. A wire it does not return is a
 * connection silently lost.
 *
 * Adaptive thresholding cannot miss a drawn wire, because it does not look for
 * wires at all — it looks for ink that is darker than its surroundings. Being
 * local, it also survives the uneven lighting of a photograph of paper, which a
 * single global threshold does not.
 *
 * SAM keeps the job it is reliable at: saying where the components are, so they
 * can be erased and what remains is wire. That is the division of labour the
 * published systems in this space all converged on.
 */

import sharp from 'sharp';

export interface InkOptions {
  /**
   * Half-width of the neighbourhood each pixel is compared against, as a
   * fraction of the raster's short edge. Large enough to span the gap between
   * strokes, small enough to track a lighting gradient across the page.
   */
  windowFrac?: number;
  /**
   * How much darker than its neighbourhood a pixel must be to count as ink.
   * Left out, it is chosen per image — see `pickBias`.
   */
  bias?: number;
}

const DEFAULTS = { windowFrac: 0.022 };

/**
 * Biases tried when none is given, lowest first.
 *
 * Low keeps faint pencil and also paper texture; high keeps only confident
 * strokes. The right value depends on the photograph, not on us.
 */
const BIAS_LADDER = [6, 10, 14, 18, 22, 26, 32, 40];

/**
 * A drawn circuit covers a small, fairly predictable share of its page. Much
 * more than this and the threshold is reading paper grain and lighting as ink;
 * much less and it is dropping strokes.
 */
const INK_FRACTION_MAX = 0.045;
const INK_FRACTION_MIN = 0.002;

export interface InkResult {
  raster: Uint8Array;
  bias: number;
  /** Share of the raster that is ink, after thresholding. */
  fraction: number;
  ruledLinesRemoved: number;
}

/**
 * Adaptive mean threshold at the given raster size.
 *
 * Implemented over an integral image, so the local mean costs four lookups per
 * pixel regardless of window size and the whole pass is linear.
 */
export async function inkRaster(
  image: Buffer,
  width: number,
  height: number,
  options: InkOptions = {},
): Promise<Uint8Array> {
  return (await inkLayer(image, width, height, options)).raster;
}

/**
 * The ink layer, with the threshold chosen for this particular image.
 *
 * The integral image is computed once and re-thresholded at each candidate
 * bias, so trying eight of them costs barely more than trying one.
 */
export async function inkLayer(
  image: Buffer,
  width: number,
  height: number,
  options: InkOptions = {},
): Promise<InkResult> {
  const windowFrac = options.windowFrac ?? DEFAULTS.windowFrac;

  const grey = await sharp(image, { failOn: 'none' })
    .greyscale()
    // A light median pass first: photographs of paper carry sensor grain, and
    // grain thresholds as ink just as readily as pencil does.
    .median(3)
    .resize(width, height, { fit: 'fill' })
    .raw()
    .toBuffer();

  // Integral image, with a zero row and column so every window is one formula.
  const iw = width + 1;
  const integral = new Float64Array(iw * (height + 1));
  for (let y = 0; y < height; y++) {
    let rowSum = 0;
    for (let x = 0; x < width; x++) {
      rowSum += grey[y * width + x];
      integral[(y + 1) * iw + (x + 1)] = integral[y * iw + (x + 1)] + rowSum;
    }
  }

  const radius = Math.max(3, Math.round(Math.min(width, height) * windowFrac));
  const total = width * height;

  /** Local mean minus the pixel: how much darker than its surroundings it is. */
  const darkness = new Float32Array(total);
  for (let y = 0; y < height; y++) {
    const y0 = Math.max(0, y - radius);
    const y1 = Math.min(height - 1, y + radius);
    for (let x = 0; x < width; x++) {
      const x0 = Math.max(0, x - radius);
      const x1 = Math.min(width - 1, x + radius);
      const area = (x1 - x0 + 1) * (y1 - y0 + 1);
      const sum = integral[(y1 + 1) * iw + (x1 + 1)]
        - integral[y0 * iw + (x1 + 1)]
        - integral[(y1 + 1) * iw + x0]
        + integral[y0 * iw + x0];
      darkness[y * width + x] = sum / area - grey[y * width + x];
    }
  }

  const threshold = (bias: number) => {
    const out = new Uint8Array(total);
    let count = 0;
    for (let i = 0; i < total; i++) {
      if (darkness[i] > bias) { out[i] = 1; count++; }
    }
    return { out, fraction: count / total };
  };

  if (options.bias != null) {
    const { out, fraction } = threshold(options.bias);
    const ruledLinesRemoved = removeRuledLines(out, width, height) + removeHairlines(out, width, height);
    return { raster: out, bias: options.bias, fraction, ruledLinesRemoved };
  }

  // Lowest bias that brings the ink down to a plausible share of the page: keep
  // as much faint stroke as possible without admitting paper texture.
  let chosen = threshold(BIAS_LADDER[BIAS_LADDER.length - 1]);
  let chosenBias = BIAS_LADDER[BIAS_LADDER.length - 1];
  for (const bias of BIAS_LADDER) {
    const result = threshold(bias);
    if (result.fraction <= INK_FRACTION_MAX) {
      chosen = result;
      chosenBias = bias;
      break;
    }
  }
  // Nothing came back: the page is probably blank or the photo is washed out.
  if (chosen.fraction < INK_FRACTION_MIN) {
    const fallback = threshold(BIAS_LADDER[0]);
    chosen = fallback;
    chosenBias = BIAS_LADDER[0];
  }

  const ruledLinesRemoved = removeRuledLines(chosen.out, width, height)
    + removeHairlines(chosen.out, width, height);
  return { raster: chosen.out, bias: chosenBias, fraction: chosen.fraction, ruledLinesRemoved };
}

/** Horizontal hairline runs at least this long are printed rules, not strokes. */
const MIN_RULE_RUN = 10;

/**
 * Removes printed ruled lines, by thickness.
 *
 * Ruled and graph paper thresholds as ink exactly like pencil does, and a rule
 * crossing the drawing will bridge every net it touches — two separate branches
 * silently become one. Dropping whole rows only catches a rule that spans the
 * sheet; the dangerous ones are the dashes that survive inside the circuit.
 *
 * Thickness separates them. A printed rule is a single pixel tall at the working
 * resolution, while a pen stroke is two or more. So a long horizontal run whose
 * every pixel is alone in its column is paper, and a stroke is not.
 */
export function removeHairlines(raster: Uint8Array, width: number, height: number): number {
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= width || y >= height ? 0 : raster[y * width + x]);
  const doomed: number[] = [];

  for (let y = 0; y < height; y++) {
    let runStart = -1;
    for (let x = 0; x <= width; x++) {
      // A pixel continues a hairline run if it is ink and stands alone vertically.
      const hairline = x < width && at(x, y) === 1 && at(x, y - 1) === 0 && at(x, y + 1) === 0;
      if (hairline) {
        if (runStart < 0) runStart = x;
        continue;
      }
      if (runStart >= 0 && x - runStart >= MIN_RULE_RUN) {
        for (let k = runStart; k < x; k++) doomed.push(y * width + k);
      }
      runStart = -1;
    }
  }

  for (const i of doomed) raster[i] = 0;
  return doomed.length;
}

/**
 * Drops rows and columns that are almost entirely ink.
 *
 * On ruled or graph paper the printed rules threshold as ink like anything else,
 * and a rule running the width of the page would bridge every net it crosses.
 * A drawn circuit never spans the sheet edge to edge, so a line that does is the
 * paper, not the circuit.
 */
export function removeRuledLines(
  raster: Uint8Array,
  width: number,
  height: number,
  /** Fraction of a row or column that must be ink before it is treated as a rule. */
  threshold = 0.82,
): number {
  let removed = 0;

  for (let y = 0; y < height; y++) {
    let count = 0;
    for (let x = 0; x < width; x++) count += raster[y * width + x];
    if (count >= width * threshold) {
      for (let x = 0; x < width; x++) raster[y * width + x] = 0;
      removed++;
    }
  }

  for (let x = 0; x < width; x++) {
    let count = 0;
    for (let y = 0; y < height; y++) count += raster[y * width + x];
    if (count >= height * threshold) {
      for (let y = 0; y < height; y++) raster[y * width + x] = 0;
      removed++;
    }
  }

  return removed;
}
