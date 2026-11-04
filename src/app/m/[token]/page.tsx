import { Suspense } from 'react';
import { notFound } from 'next/navigation';
import PhoneCapture from '@/components/PhoneCapture';
import { TOKEN_RE } from '@/lib/pair/store';

export const metadata = { title: 'Send a circuit — Sketch → Circuit' };

/**
 * The page a phone lands on after scanning the code. The token comes from the
 * URL, which is runtime data, so it is read inside a Suspense boundary and the
 * shell around it can still be prerendered.
 */
export default function Page({ params }: PageProps<'/m/[token]'>) {
  return (
    <Suspense fallback={<main className="min-h-dvh" />}>
      <Capture params={params} />
    </Suspense>
  );
}

async function Capture({ params }: { params: PageProps<'/m/[token]'>['params'] }) {
  const { token } = await params;
  // A malformed token can never name a session, so say so now instead of after a
  // photo has been taken and uploaded for nothing.
  if (!TOKEN_RE.test(token)) notFound();
  return <PhoneCapture token={token} />;
}
