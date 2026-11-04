'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

interface Props {
  /** Called once with the photo when it arrives from the phone. */
  onImage: (blob: Blob) => void;
}

interface Session {
  token: string;
  url: string;
  svg: string;
  reachable: boolean;
}

type Phase = 'idle' | 'creating' | 'waiting' | 'receiving' | 'expired' | 'error';

const POLL_MS = 1200;

/**
 * Pairs a phone with this screen: show a QR code, wait for a photo, hand it on.
 *
 * Polling is a deliberate choice over a held-open connection. The wait is a few
 * seconds to a few minutes, each poll is a few bytes, and it behaves the same
 * behind any proxy or tunnel, which is where this will be demonstrated.
 *
 * The session and the phase are separate pieces of state on purpose. They used to
 * be one, so announcing "Photo received" changed the value the polling effect
 * depended on: React tore the effect down mid-collection, its cleanup set the
 * cancelled flag, and the fetch that was already in flight returned to a guard
 * that threw the photo away. The server had handed the image over and deleted it
 * by then, so the screen sat on "Photo received" for ever and the phone was told
 * the session had ended. The effect now depends on the token alone.
 */
export default function PhonePair({ onImage }: Props) {
  const [session, setSession] = useState<Session | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [message, setMessage] = useState<string | null>(null);
  const onImageRef = useRef(onImage);
  useEffect(() => { onImageRef.current = onImage; });

  // A poll that takes longer than the interval would otherwise start a second
  // collection, and the second one finds the session already emptied.
  const collecting = useRef(false);
  const token = session?.token ?? null;

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    collecting.current = false;

    const tick = async () => {
      if (cancelled || collecting.current) return;
      try {
        const res = await fetch(`/api/pair/${token}`, { cache: 'no-store' });
        if (cancelled || collecting.current) return;
        const body = (await res.json()) as { status: 'waiting' | 'ready' | 'expired' };
        if (body.status === 'expired') { setPhase('expired'); setSession(null); return; }
        if (body.status !== 'ready') return;

        collecting.current = true;
        setPhase('receiving');
        const image = await fetch(`/api/pair/${token}/image`, { cache: 'no-store' });
        if (!image.ok) {
          collecting.current = false;
          setMessage('The photo could not be collected. Try again.');
          setPhase('error');
          setSession(null);
          return;
        }
        // Collecting empties the mailbox on the server, so these bytes are the
        // only copy: hand them over whatever else has happened meanwhile.
        onImageRef.current(await image.blob());
      } catch {
        // A failed poll is not a failed session; the next one decides. A failure
        // while collecting is fatal to this session, since the photo is gone.
        if (collecting.current) {
          collecting.current = false;
          setMessage('The photo could not be collected. Scan the code again.');
          setPhase('error');
          setSession(null);
        }
      }
    };

    const timer = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, [token]);

  const open = useCallback(async () => {
    setPhase('creating');
    setMessage(null);
    try {
      const res = await fetch('/api/pair', { method: 'POST' });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { token: string; url: string; reachable: boolean };
      // Light modules on a white square: phone cameras read that far more reliably
      // than the same code inverted onto this app's dark background.
      // Loaded now, not at page load: most visitors never open this panel.
      const QRCode = (await import('qrcode')).default;
      const svg = await QRCode.toString(body.url, {
        type: 'svg', margin: 2, errorCorrectionLevel: 'M',
        color: { dark: '#07090d', light: '#ffffff' },
      });
      setSession({ token: body.token, url: body.url, svg, reachable: body.reachable });
      setPhase('waiting');
    } catch {
      setMessage('Could not start a phone session. Try again.');
      setPhase('error');
    }
  }, []);

  if (phase === 'receiving') {
    return (
      <div className="mt-4 rounded-xl border border-ok/40 bg-ok/[0.06] px-5 py-4" role="status">
        <p className="text-[14px] text-ok">Photo received</p>
      </div>
    );
  }

  if (phase !== 'waiting' || !session) {
    return (
      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-edge bg-raised px-5 py-4">
        <div className="min-w-0 flex-1">
          <p className="text-[14px] text-ink">Use your phone</p>
          <p className="mt-0.5 text-[12px] text-faint">
            {phase === 'expired' ? 'That code expired.'
              : phase === 'error' ? message
              : 'Scan a code, photograph the circuit, and it appears here.'}
          </p>
        </div>
        <button
          type="button"
          onClick={open}
          disabled={phase === 'creating'}
          className="h-11 shrink-0 rounded-md border border-edge-strong px-4 text-[14px] text-ink transition hover:border-accent/50 hover:bg-white/[0.03] disabled:opacity-50"
        >
          {phase === 'creating' ? 'Starting…' : phase === 'idle' ? 'Show QR code' : 'New QR code'}
        </button>
      </div>
    );
  }

  return (
    <div className="mt-4 flex flex-wrap items-center gap-5 rounded-xl border border-accent/30 bg-raised p-5">
      <div
        className="h-44 w-44 shrink-0 overflow-hidden rounded-lg bg-white [&>svg]:h-full [&>svg]:w-full"
        role="img"
        aria-label="QR code. Scan it with your phone's camera."
        dangerouslySetInnerHTML={{ __html: session.svg }}
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
        <p className="mt-3 break-all font-mono text-[11px] text-faint">{session.url}</p>
        {!session.reachable && (
          <p className="mt-3 rounded border border-warn/40 bg-warn/[0.08] px-3 py-2 text-[12px] leading-relaxed text-warn">
            This address only works on this computer. Open the app by its network address,
            or set PUBLIC_ORIGIN.
          </p>
        )}
        <button
          type="button"
          onClick={() => { setSession(null); setPhase('idle'); }}
          className="mt-3 text-[12px] text-faint underline underline-offset-4 transition hover:text-dim"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
