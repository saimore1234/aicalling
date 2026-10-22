'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { AuthShell } from '@/components/AuthShell';
import { Button, ErrorBox, Field, Input, Notice, Spinner } from '@/components/ui';
import { api, ApiClientError } from '@/lib/client/fetcher';

export default function SetupPage() {
  const [state, setState] = useState<{ needsSetup: boolean; webSetupEnabled: boolean } | null>(null);
  const [f, setF] = useState({ setupToken: '', name: '', email: '', password: '' });
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api<{ needsSetup: boolean; webSetupEnabled: boolean }>('/api/setup').then(setState).catch(setError as never); }, []);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { await api('/api/setup', { body: f }); window.location.href = '/dashboard'; }
    catch (err) { setError(err); setBusy(false); }
  }
  const fe = error instanceof ApiClientError ? error.fieldErrors : undefined;
  return (
    <AuthShell title="Create the first administrator" subtitle="This page works only once, while no administrator exists.">
      {!state ? <Spinner /> : !state.needsSetup ? (
        <Notice tone="blue">Setup is already complete. <Link href="/login" className="font-medium underline">Go to sign in</Link>.</Notice>
      ) : !state.webSetupEnabled ? (
        <Notice tone="amber" title="Web setup is disabled">Set the <code>SETUP_TOKEN</code> environment variable and restart, or run <code>npm run admin:create</code> on the server.</Notice>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <Field label="Setup token" hint="The SETUP_TOKEN value from the server environment.">{(id) => <Input id={id} type="password" required value={f.setupToken} onChange={set('setupToken')} autoComplete="off" />}</Field>
          <Field label="Your name" error={fe?.name}>{(id) => <Input id={id} required value={f.name} onChange={set('name')} />}</Field>
          <Field label="Email" error={fe?.email}>{(id) => <Input id={id} type="email" required value={f.email} onChange={set('email')} autoComplete="username" />}</Field>
          <Field label="Password" hint="At least 12 characters." error={fe?.password}>{(id) => <Input id={id} type="password" required minLength={12} value={f.password} onChange={set('password')} autoComplete="new-password" />}</Field>
          {!!error && !fe && <ErrorBox error={error} />}
          <Button type="submit" variant="primary" loading={busy} className="w-full">Create administrator</Button>
        </form>
      )}
    </AuthShell>
  );
}
