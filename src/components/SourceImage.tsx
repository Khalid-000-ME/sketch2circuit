'use client';

import { useState } from 'react';
import type { AnalyzeResponse } from '@/lib/types';

/**
 * The submitted photo, with SAM's masks drawn over it (FR-1.7).
 *
 * The overlay is here because the segmentation is load-bearing and invisible
 * otherwise: it is the difference between "a model guessed" and "these exact
 * pixels were isolated and walked". Toggleable, because once you trust it you
 * want to see your own sketch.
 */

export default function SourceImage({
  src, segmentation,
}: { src: string; segmentation: AnalyzeResponse['segmentation'] }) {
  const [showMasks, setShowMasks] = useState(true);
  const hasMasks = Boolean(segmentation?.masks?.length);

  const concepts = segmentation
    ? [...new Set(segmentation.masks.map((m) => m.concept))]
    : [];
  const hue = (concept: string) => {
    let h = 0;
    for (let i = 0; i < concept.length; i++) h = (h * 31 + concept.charCodeAt(i)) % 360;
    return h;
  };

  return (
    <div className="overflow-hidden rounded-lg border border-edge bg-raised">
      <div className="relative bg-white">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="The sketch that was submitted" className="block w-full" />
        {hasMasks && showMasks && segmentation && (
          <svg
            viewBox={`0 0 ${segmentation.image_width} ${segmentation.image_height}`}
            className="pointer-events-none absolute inset-0 h-full w-full"
            aria-hidden
          >
            {segmentation.masks.map((m) => {
              const h = hue(m.concept);
              const [x, y, w, hgt] = m.bbox;
              return (
                <g key={m.mask_id}>
                  {m.svg_path && (
                    <g transform={`translate(${x} ${y})`}>
                      <path d={m.svg_path} fill={`hsl(${h} 90% 55% / 0.3)`} stroke={`hsl(${h} 90% 60%)`} strokeWidth={2} />
                    </g>
                  )}
                  {!m.svg_path && (
                    <rect x={x} y={y} width={w} height={hgt} fill="none" stroke={`hsl(${h} 90% 60%)`} strokeWidth={3} />
                  )}
                </g>
              );
            })}
          </svg>
        )}
      </div>

      <div className="flex items-center gap-2 px-3 py-2.5">
        <span className="text-[11px] uppercase tracking-wider text-faint">Your sketch</span>
        {hasMasks && (
          <button
            type="button"
            onClick={() => setShowMasks((v) => !v)}
            className="ml-auto rounded border border-edge px-2 py-1 text-[11px] text-dim transition hover:border-accent/50 hover:text-ink"
          >
            {showMasks ? 'Hide' : 'Show'} SAM masks
          </button>
        )}
      </div>

      {hasMasks && showMasks && concepts.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-t border-edge px-3 py-2.5">
          {concepts.map((concept) => (
            <span key={concept} className="flex items-center gap-1.5 text-[11px] text-dim">
              <span
                className="h-2 w-2 rounded-sm"
                style={{ background: `hsl(${hue(concept)} 90% 60%)` }}
                aria-hidden
              />
              {concept}
              <span className="text-faint">
                ({segmentation!.masks.filter((m) => m.concept === concept).length})
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
