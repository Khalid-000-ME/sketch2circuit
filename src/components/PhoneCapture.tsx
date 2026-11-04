'use client';

import { useRef, useState } from 'react';
import { prepareImage } from '@/lib/client/api';

type Phase = 'idle' | 'sending' | 'sent' | 'failed' | 'ended';

/**
 * The phone side of pairing: one job, one button.
 *
 * The photo is taken with the device's own camera app through a file input rather
 * than a live viewfinder. That works over plain HTTP on a local network, where
 * getUserMedia is refused, and the OS camera gives a full-resolution, properly
 * focused shot with the controls the person already knows.
 */
export default function PhoneCapture({ token }: { token: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [preview, setPreview] = useState<string | null>(null);
  // A link closes as soon as the computer collects the photo, so "ended" after a
  // successful send means it arrived — the opposite of what it means before one.
  const [sentOnce, setSentOnce] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const send = async (file: File) => {
    setPhase('sending');
    setMessage(null);
    try {
      const { blob, previewUrl } = await prepareImage(file);
      setPreview(previewUrl);
      const form = new FormData();
      form.append('image', blob, 'sketch.jpg');
      const res = await fetch(`/api/pair/${token}`, { method: 'POST', body: form });
      if (res.status === 410 || res.status === 404) {
        setPhase('ended');
        return;
      }
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        setMessage(body?.error ?? 'That did not send. Try again.');
        setPhase('failed');
        return;
      }
      setSentOnce(true);
      setPhase('sent');
    } catch {
      setMessage('That did not send. Check your connection and try again.');
      setPhase('failed');
    }
  };

  const open = () => inputRef.current?.click();
  const busy = phase === 'sending';

  return (
    <main className="workspace-grid flex min-h-dvh flex-col px-5 py-8">
      <div className="mx-auto flex w-full max-w-sm flex-1 flex-col">
        <p className="text-[13px] font-medium text-accent">Sketch → Circuit</p>

        {phase === 'ended' ? (
          <div className="my-auto">
            <h1 className="text-2xl font-semibold leading-tight">
              {sentOnce ? 'Your photo is already there' : 'This session has ended'}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-dim">
              {sentOnce
                ? 'Your computer picked it up, which closes the link. To send another, start a new sketch there and scan the new code.'
                : 'Scan the code on your computer again.'}
            </p>
          </div>
        ) : (
          <>
            <h1 className="mt-6 text-[1.7rem] font-semibold leading-tight tracking-tight">
              {phase === 'sent' ? 'Sent to your computer' : 'Photograph your circuit'}
            </h1>
            <p className="mt-3 text-[15px] leading-relaxed text-dim">
              {phase === 'sent'
                ? 'Your analysis is starting on the screen you scanned from.'
                : 'Lay the paper flat, keep the whole drawing in frame, and avoid shadows across it.'}
            </p>

            {preview && (
              <div className="mt-6 overflow-hidden rounded-lg border border-edge bg-white">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={preview} alt="The photo you took" className="block max-h-[46dvh] w-full object-contain" />
              </div>
            )}

            {message && (
              <p role="alert" className="mt-4 rounded-lg border border-error/40 bg-error/[0.08] px-4 py-3 text-[13px] text-error">
                {message}
              </p>
            )}

            <div className="mt-auto pt-8">
              <button
                type="button"
                onClick={open}
                disabled={busy}
                className={`h-14 w-full rounded-lg text-[16px] font-medium transition disabled:opacity-60 ${
                  phase === 'sent'
                    ? 'border border-edge-strong text-ink'
                    : 'bg-accent text-[#04141a]'
                }`}
              >
                {busy ? 'Sending…' : phase === 'sent' ? 'Take another' : phase === 'failed' ? 'Try again' : 'Take a photo'}
              </button>
              <button
                type="button"
                onClick={() => { inputRef.current?.removeAttribute('capture'); open(); }}
                disabled={busy}
                className="mt-3 h-11 w-full text-[14px] text-dim underline underline-offset-4 disabled:opacity-60"
              >
                Choose from your photos instead
              </button>
            </div>
          </>
        )}

        <input
          ref={inputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            // The photo-library path clears `capture`; restore it for next time.
            inputRef.current?.setAttribute('capture', 'environment');
            if (file) void send(file);
          }}
        />
      </div>
    </main>
  );
}
