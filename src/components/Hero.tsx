'use client';

import { useEffect, useState } from 'react';
import Grainient from '@/components/Grainient';

/**
 * The landing hero.
 *
 * A Grainient field sits behind everything, with a blur and a scrim over it. The
 * blur is doing real work rather than decoration: the gradient moves, and moving
 * colour behind small text destroys legibility. Blurring it to a wash, then
 * laying a dark scrim on top, gives every line a stable background to sit on, so
 * the headline and the body text keep their contrast wherever the colour happens
 * to be that second.
 *
 * The field fades into the page background at the bottom, so the capture panel
 * below reads as the same surface rather than a second screen.
 */
export default function Hero({ onStart }: { onStart: () => void }) {
  // The field drifts and the grain crawls. Honour a person who has asked the
  // system for less of that: it is decoration, and it is the whole background.
  const [still, setStill] = useState(false);
  useEffect(() => {
    const q = window.matchMedia('(prefers-reduced-motion: reduce)');
    const apply = () => setStill(q.matches);
    apply();
    q.addEventListener('change', apply);
    return () => q.removeEventListener('change', apply);
  }, []);

  return (
    <section className="relative isolate overflow-hidden border-b border-edge">
      <div className="absolute inset-0 -z-10" aria-hidden>
        <Grainient
          colors={['#07090d', '#0a1420', '#10384d', '#1b7f9e', '#6ee7ff']}
          type="linear"
          angle={38}
          speed={still ? 0 : 0.35}
          flow={0.55}
          scale={1.3}
          softness={1.25}
          silk={0.45}
          grainAmount={0.075}
          grainAnimated={!still}
          contrast={1.12}
          saturation={1.08}
          interactive={!still}
          stir={0.5}
          clickSwirl={false}
          intro={!still}
          className="h-full w-full"
        />
        {/*
          The blur layer the design asks for, then a scrim. backdrop-filter needs
          something painted underneath it, which is what the Grainient canvas is.
        */}
        <div className="absolute inset-0 backdrop-blur-[56px]" />
        <div className="absolute inset-0 bg-gradient-to-b from-bg/45 via-bg/50 to-bg" />
      </div>

      <div className="mx-auto w-full max-w-3xl px-5 pb-14 pt-16 sm:pb-20 sm:pt-24">
        <p className="font-mono text-[12px] uppercase tracking-[0.2em] text-accent">
          Sketch <span aria-hidden>→</span> Circuit
        </p>

        <h1 className="mt-6 font-display text-[clamp(3.1rem,11vw,6.5rem)] leading-[0.92] tracking-[-0.02em] text-ink">
          Paper in.
          <br />
          Physics out.
        </h1>

        <p className="mt-7 max-w-xl text-[17px] leading-relaxed text-dim">
          Photograph a circuit you drew by hand. It is read, simulated for real, and
          told back to you in plain language — before you connect the battery.
        </p>

        <div className="mt-9 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={onStart}
            className="h-12 rounded-md bg-accent px-6 text-[15px] font-medium text-[#04141a] transition hover:brightness-110"
          >
            Analyse a sketch
          </button>
          <a
            href="#samples"
            className="h-12 rounded-md border border-edge-strong px-6 text-[15px] leading-[3rem] text-ink transition hover:border-accent/50 hover:bg-white/[0.03]"
          >
            See a worked example
          </a>
        </div>

        <dl className="mt-12 flex flex-wrap gap-x-10 gap-y-5">
          {[
            ['0.1%', 'Solver against hand calculation'],
            ['3/3', 'Exact netlists on our test sketches'],
            ['DC', 'Real operating point, not a drawing'],
          ].map(([value, label]) => (
            <div key={label}>
              <dt className="font-mono text-[26px] leading-none text-ink">{value}</dt>
              <dd className="mt-2 max-w-[13rem] text-[13px] leading-snug text-faint">{label}</dd>
            </div>
          ))}
        </dl>
      </div>
    </section>
  );
}
