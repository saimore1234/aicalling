'use client';
import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { AuthShell } from '@/components/AuthShell';
import { Button, ErrorBox, Field, Input, Notice } from '@/components/ui';
import { api } from '@/lib/client/fetcher';

function LoginForm() {
  const params = useSearchParams();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [needsSetup, setNeedsSetup] = useState(false);

  useEffect(() => { api<{ needsSetup: boolean; webSetupEnabled: boolean }>('/api/setup').then((s) => setNeedsSetup(s.needsSetup)).catch(() => undefined); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const r = await api<{ user: { mustChangePassword: boolean } }>('/api/auth/login', { body: { email, password } });
      const next = params.get('next');
      const safe = next && next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';
      window.location.href = r.user.mustChangePassword ? '/account?forced=1' : safe;
    } catch (err) { setError(err); setBusy(false); }
  }
  return (
    <AuthShell title="Sign in" subtitle="Use your work account to continue.">
      <form onSubmit={submit} className="space-y-4">
        {needsSetup && <Notice tone="blue" title="First-time setup">No administrator exists yet. <Link href="/setup" className="font-medium underline">Create the first administrator</Link>.</Notice>}
        {params.get('reset') && <Notice tone="green">Password updated. Please sign in.</Notice>}
        <Field label="Email">{(id) => <Input id={id} type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} autoFocus />}</Field>
        <Field label="Password">{(id) => <Input id={id} type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />}</Field>
        {!!error && <ErrorBox error={error} />}
        <Button type="submit" variant="primary" loading={busy} className="w-full">Sign in</Button>
        <p className="text-center text-sm"><Link href="/forgot-password" className="muted hover:underline">Forgot your password?</Link></p>
      </form>
    </AuthShell>
  );
}
export default function LoginPage() { return <Suspense><LoginForm /></Suspense>; }
