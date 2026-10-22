'use client';
import Link from 'next/link';
import { Suspense, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { Button, ErrorBox, Field, Input, Notice } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/fetcher';

function Form() {
  const token = useSearchParams().get('token') ?? '';
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  async function submit(e: React.FormEvent) {
    e.preventDefault(); setError(null);
    if (password !== confirm) { setError(new Error('Passwords do not match')); return; }
    setBusy(true);
    try { await api('/api/auth/reset', { body: { token, password } }); window.location.href = '/login?reset=1'; }
    catch (err) { setError(err); setBusy(false); }
  }
  const fe = error instanceof ApiClientError ? error.fieldErrors : undefined;
  if (!token) return <Notice tone="red">This reset link is missing its token. <Link href="/forgot-password" className="underline">Request a new one</Link>.</Notice>;
  return (
    <form onSubmit={submit} className="space-y-4">
      <Field label="New password" hint="At least 12 characters." error={fe?.password}>{(id) => <Input id={id} type="password" required minLength={12} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}</Field>
      <Field label="Confirm new password">{(id) => <Input id={id} type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" />}</Field>
      {!!error && !fe && <ErrorBox error={error} />}
      <Button type="submit" variant="primary" loading={busy} className="w-full">Set new password</Button>
    </form>
  );
}
export default function ResetPage() { return <AuthShell title="Choose a new password"><Suspense><Form /></Suspense></AuthShell>; }
