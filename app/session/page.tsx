'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { SessionEditor } from '@/components/session-editor';

function SessionPageInner() {
  const searchParams = useSearchParams();
  const idParam = searchParams.get('id');
  const sessionId = idParam ? parseInt(idParam, 10) : NaN;
  return <SessionEditor sessionId={sessionId} />;
}

export default function SessionPage() {
  // Wrapped in Suspense because useSearchParams() requires it during
  // static export / prerendering.
  return (
    <Suspense fallback={null}>
      <SessionPageInner />
    </Suspense>
  );
}
