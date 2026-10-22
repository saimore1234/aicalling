'use client';
import { use, useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { Button, ErrorBox, Notice } from '@/components/ui';
import { api } from '@/lib/client/fetcher';

/** Public one-click unsubscribe page. The signed token in the URL identifies the customer and channel. */
export default function UnsubscribePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle');
  const [error, setError] = useState<unknown>(null);
  async function go() {
    setState('busy'); setError(null);
    try { await api('/api/unsubscribe', { body: { token } }); setState('done'); } catch (e) { setError(e); setState('idle'); }
  }
  return (
    <AuthShell title="Unsubscribe" subtitle="Confirm that you no longer want to receive these messages.">
      {state === 'done' ? <Notice tone="green" title="You have been unsubscribed">We will not contact you on this channel again.</Notice> : (
        <div className="space-y-4">
          {!!error && <ErrorBox error={error} />}
          <Button variant="primary" loading={state === 'busy'} onClick={go} className="w-full">Unsubscribe me</Button>
        </div>
      )}
    </AuthShell>
  );
}
