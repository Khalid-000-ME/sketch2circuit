'use client';

import { useEffect, useRef, useState } from 'react';
import QRCode from 'qrcode';

interface Props {
  /** Called once with the photo when it arrives from the phone. */
  onImage: (blob: Blob) => void;
}

type State =
  | { kind: 'idle' }
  | { kind: 'creating' }
  | { kind: 'waiting'; token: string; url: string; svg: string; reachable: boolean }
  | { kind: 'receiving' }
  | { kind: 'expired' }
  | { kind: 'error'; message: string };

const POLL_MS = 1200;

/**
 * Pairs a phone with this screen: show a QR code, wait for a photo, hand it on.
 *
 * Polling is a deliberate choice over a held-open connection. The wait is a few
 * seconds to a few minutes, each poll is a few bytes, and it behaves the same
 * behind any proxy or tunnel, which is where this will be demonstrated.
 */
export default function PhonePair({ onImage }: Props) {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const onImageRef = useRef(onImage);
  useEffect(() => { onImageRef.current = onImage; });

  const token = state.kind === 'waiting' ? state.token : null;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;

    const tick = async () => {
      try {
        const res = await fetch(`/api/pair/${token}`, { cache: 'no-store' });
        if (cancelled) return;
        const body = (await res.json()) as { status: 'waiting' | 'ready' | 'expired' };
        if (body.status === 'expired') { setState({ kind: 'expired' }); return; }
        if (body.status !== 'ready') return;

        setState({ kind: 'receiving' });
        const image = await fetch(`/api/pair/${token}/image`, { cache: 'no-store' });
        if (cancelled) return;
        if (!image.ok) { setState({ kind: 'error', message: 'The photo could not be collected. Try again.' }); return; }
        onImageRef.current(await image.blob());
      } catch {
        // A failed poll is not a failed session; the next one decides.
      }
    };

    const timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [token]);

  const open = async () => {
    setState({ kind: 'creating' });
    try {
      const res = await fetch('/api/pair', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { token: string; url: string; reachable: boolean };
      // Light modules on a white square: phone cameras read that far more reliably
      // than the same code inverted onto this app's dark background.
      const svg = await QRCode.toString(body.url, {
        type: 'svg', margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#07090d', light: '#ffffff' },
      });
      setState({ kind: 'waiting', token: body.token, url: body.url, svg, reachable: body.reachable });
    } catch {
      setState({ kind: 'error', message: 'Could not start a phone session. Try again.' });
    }
  };

  if (state.kind === 'idle' || state.kind === 'creating' || state.kind === 'expired' || state.kind === 'error') {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-raised px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-ink">Use your phone</p>
          <p className="mt-0.5 text-[12px] text-faint">
            {state.kind === 'expired' ? 'That code expired.'
              : state.kind === 'error' ? state.message
              : 'Scan a code, photograph the circuit, and it appears here.'}
          </p>
        </div>
        <button
          type="button"
          onClick={open}
          disabled={state.kind === 'creating'}
          className="h-11 shrink-0 rounded-md border border-edge-strong px-4 text-[14px] text-ink transition hover:border-accent/50 hover:bg-white/[0.03] disabled:opacity-50"
        >
          {state.kind === 'creating' ? 'Starting…' : state.kind === 'idle' ? 'Show QR code' : 'New QR code'}
        </button>
      </div>
    );
  }

  if (state.kind === 'receiving') {
    return (
      <div className="mt-4 rounded-xl border border-ok/40 bg-ok/[0.06] px-5 py-4" role="status">
        <p className="text-[14px] text-ok">Photo received</p>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl border border-accent/30 bg-raised p-5">
      <div
        className="h-44 w-44 shrink-0 overflow-hidden rounded-lg bg-white [&>svg]:h-full [&>svg]:w-full"
        role="img"
        aria-label="QR code. Scan it with your phone's camera."
        dangerouslySetInnerHTML={{ __html: state.svg }}
      />
      <div className="min-w-0 flex-1" style={{ minWidth: '12rem' }}>
        <p className="text-[14px] text-ink">Scan with your phone</p>
        <p className="mt-1 text-[12px] leading-relaxed text-faint">
          Open the camera, point it at the code, then take a photo of your circuit.
        </p>
        <p className="mt-3 flex items-center gap-2 text-[12px] text-dim" role="status">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-accent" aria-hidden />
          Waiting for your photo
        </p>
        <p className="mt-3 break-all font-mono text-[11px] text-faint">{state.url}</p>
        {!state.reachable && (
          <p className="mt-3 rounded border border-warn/40 bg-warn/[0.08] px-3 py-2 text-[12px] leading-relaxed text-warn">
            This address only works on this computer. Open the app by its network address,
            or set PUBLIC_ORIGIN.
          </p>
        )}
        <button
          type="button"
          onClick={() => setState({ kind: 'idle' })}
          className="mt-3 text-[12px] text-faint underline underline-offset-4 transition hover:text-dim"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
