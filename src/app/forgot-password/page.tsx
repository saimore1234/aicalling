'use client';
import Link from 'next/link';
import { useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { Button, ErrorBox, Field, Input, Notice } from '@/components/ui';
import { api } from '@/lib/client/fetcher';

export default function ForgotPage() {
  const [email, setEmail] = useState('');
  const [done, setDone] = useState<{ emailConfigured: boolean; message?: string } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { setDone(await api('/api/auth/forgot', { body: { email } })); } catch (err) { setError(err); } finally { setBusy(false); }
  }
  return (
    <AuthShell title="Reset your password">
      {done ? (
        <div className="space-y-4">
          <Notice tone={done.emailConfigured ? 'green' : 'amber'}>{done.emailConfigured ? 'If an account exists for that email, a reset link has been sent. The link expires in 30 minutes.' : done.message}</Notice>
          <Link href="/login" className="text-sm font-medium text-brand-600 hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Email">{(id) => <Input id={id} type="email" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
          {!!error && <ErrorBox error={error} />}
          <Button type="submit" variant="primary" loading={busy} className="w-full">Send reset link</Button>
          <p className="text-center text-sm"><Link href="/login" className="muted hover:underline">Back to sign in</Link></p>
        </form>
      )}
    </AuthShell>
  );
}
